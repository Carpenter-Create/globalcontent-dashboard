import {
  assertCanonicalContractYaml,
  parseCanonicalContractYaml,
} from "./contract-yaml";
import { digestContractFileBytes } from "./contract-digest";
import {
  type ControlStore,
  type ControlTip,
  type MutableControlStore,
  cloneObjects,
  contentDigestMap,
  isMutableControlStore,
} from "./control-store";
import {
  formatContractPath,
  formatEventPath,
  formatProposedPath,
  parseEventPath,
} from "./control-paths";
import { verifyEventChain } from "./event-chain";
import { withEventDigest } from "./event-digest";
import type {
  ControlEvent,
  ControlEventPreimage,
  ControlEventType,
} from "./event-schema";
import { genesisPrevEventDigest } from "./genesis";
import {
  isOperationalEventType,
  isPrivilegedEventType,
} from "./privileged-events";
import { verifyProtectedObjectDelta } from "./protected-delta";
import { foldTaskState } from "./state-fold";

export type LedgerIssue = { code: string; message: string };

export type LedgerResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: LedgerIssue[] };

export type AppendEventInput = {
  store: ControlStore;
  expectedTip: ControlTip;
  taskId: string;
  eventType: ControlEventType;
  payload: Record<string, unknown>;
  occurredAt: string;
  actor: ControlEvent["actor"];
  /**
   * Optional claimed active-contract pins. When provided they must match the
   * pins derived from the verified current chain (caller cannot select an
   * arbitrary contract). Prefer omitting and letting the ledger derive them.
   */
  claimedActiveContractVersion?: number;
  claimedActiveContractDigest?: string;
};

export type AppendEventSuccess = {
  tip: ControlTip;
  event: ControlEvent;
  eventPath: string;
  objects: ReadonlyMap<string, string>;
};

type InternalCommitInput = {
  store: ControlStore;
  expectedTip: ControlTip;
  taskId: string;
  eventType: ControlEventType;
  payload: Record<string, unknown>;
  occurredAt: string;
  actor: ControlEvent["actor"];
  /**
   * When set, use these pins (authorize / first contract_staged).
   * Otherwise derive from prior chain.
   */
  overrideActiveContract?: { version: number; digest: string };
  claimedActiveContractVersion?: number;
  claimedActiveContractDigest?: string;
  extraObjects?: Map<string, string>;
  /** Allow privileged event types (dedicated founder / stage APIs only). */
  allowPrivileged: boolean;
};

function fail<T = never>(code: string, message: string): LedgerResult<T> {
  return { ok: false, issues: [{ code, message }] };
}

function requireMutable(store: ControlStore): LedgerResult<MutableControlStore> {
  if (!isMutableControlStore(store)) {
    return fail(
      "store_not_writable",
      "control store does not expose an internal writable CAS surface",
    );
  }
  return { ok: true, value: store };
}

function listTaskEvents(
  objects: ReadonlyMap<string, string>,
  taskId: string,
): ControlEvent[] {
  const paths = [...objects.keys()]
    .map((p) => ({ path: p, parsed: parseEventPath(p) }))
    .filter((x) => x.parsed.ok && x.parsed.taskId === taskId)
    .sort((a, b) => {
      const sa = a.parsed.ok ? a.parsed.sequence : 0;
      const sb = b.parsed.ok ? b.parsed.sequence : 0;
      return sa - sb;
    });

  const events: ControlEvent[] = [];
  for (const { path } of paths) {
    const raw = objects.get(path)!;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`malformed event json at ${path}`);
    }
    events.push(parsed as ControlEvent);
  }
  return events;
}

function deriveActiveContract(
  priorEvents: ControlEvent[],
  override: { version: number; digest: string } | undefined,
): LedgerResult<{ version: number; digest: string }> {
  if (override) {
    return { ok: true, value: override };
  }
  if (priorEvents.length === 0) {
    return fail(
      "no_active_contract",
      "cannot append without an active contract; stage and authorize first",
    );
  }
  const last = priorEvents[priorEvents.length - 1];
  return {
    ok: true,
    value: {
      version: last.active_contract_version,
      digest: last.active_contract_digest,
    },
  };
}

/**
 * Trusted commit path used by stage / authorize / operational / founder APIs.
 * Never expose as unrestricted whole-ledger replacement.
 */
async function commitControlEvent(
  input: InternalCommitInput,
): Promise<LedgerResult<AppendEventSuccess>> {
  if (!input.allowPrivileged && isPrivilegedEventType(input.eventType)) {
    return fail(
      "privileged_event_rejected",
      `event type ${input.eventType} cannot be appended via the generic API`,
    );
  }
  if (!input.allowPrivileged && !isOperationalEventType(input.eventType)) {
    return fail(
      "event_type_not_operational",
      `event type ${input.eventType} is not allowed on the operational append path`,
    );
  }

  const mutable = requireMutable(input.store);
  if (!mutable.ok) return mutable;

  let snapshot;
  try {
    snapshot = await input.store.getSnapshot();
  } catch (e) {
    return fail(
      "integrity_failure",
      e instanceof Error ? e.message : String(e),
    );
  }
  if (snapshot.tip !== input.expectedTip) {
    return fail(
      "stale_tip",
      `expected tip ${input.expectedTip}, observed ${snapshot.tip}`,
    );
  }

  const priorDigests = contentDigestMap(snapshot.objects);
  let priorEvents: ControlEvent[];
  try {
    priorEvents = listTaskEvents(snapshot.objects, input.taskId);
  } catch (e) {
    return fail("malformed_prior_event", (e as Error).message);
  }

  if (priorEvents.length > 0) {
    const chain = verifyEventChain(priorEvents);
    if (!chain.ok) {
      return {
        ok: false,
        issues: chain.issues.map((i) => ({
          code: `chain_${i.code}`,
          message: i.message,
        })),
      };
    }
  }

  const active = deriveActiveContract(priorEvents, input.overrideActiveContract);
  if (!active.ok) return active;

  if (
    input.claimedActiveContractVersion !== undefined ||
    input.claimedActiveContractDigest !== undefined
  ) {
    if (
      input.claimedActiveContractVersion !== active.value.version ||
      input.claimedActiveContractDigest !== active.value.digest
    ) {
      return fail(
        "active_contract_mismatch",
        "claimed active contract does not match verified chain / frozen contract pins",
      );
    }
  }

  // Non-authorize events must not change active pins relative to prior tip.
  if (priorEvents.length > 0 && input.eventType !== "authorize") {
    const last = priorEvents[priorEvents.length - 1];
    if (
      active.value.version !== last.active_contract_version ||
      active.value.digest !== last.active_contract_digest
    ) {
      return fail(
        "active_contract_drift",
        "active contract pins must continue prior chain (only authorize may change them)",
      );
    }
  }

  const sequence = priorEvents.length + 1;
  const prev =
    sequence === 1
      ? genesisPrevEventDigest(input.taskId)
      : priorEvents[priorEvents.length - 1].event_digest;

  let event: ControlEvent;
  try {
    const preimage = {
      schema_version: 1,
      task_id: input.taskId,
      sequence,
      event_type: input.eventType,
      occurred_at: input.occurredAt,
      actor: input.actor,
      active_contract_version: active.value.version,
      active_contract_digest: active.value.digest,
      prev_event_digest: prev,
      payload: input.payload,
    } as ControlEventPreimage;
    event = withEventDigest(preimage);
  } catch (e) {
    return fail("invalid_event_schema", (e as Error).message);
  }

  const eventPath = formatEventPath(
    input.taskId,
    sequence,
    input.eventType as Parameters<typeof formatEventPath>[2],
  );

  const next = cloneObjects(snapshot.objects);
  if (input.extraObjects) {
    for (const [p, content] of input.extraObjects) {
      next.set(p, content);
    }
  }
  if (next.has(eventPath)) {
    return fail("event_path_exists", `event path already exists: ${eventPath}`);
  }
  next.set(eventPath, `${JSON.stringify(event, null, 2)}\n`);

  const delta = verifyProtectedObjectDelta(priorDigests, contentDigestMap(next));
  if (!delta.ok) {
    return {
      ok: false,
      issues: delta.issues.map((i) => ({
        code: i.code,
        message: i.message,
      })),
    };
  }

  let nextEvents: ControlEvent[];
  try {
    nextEvents = listTaskEvents(next, input.taskId);
  } catch (e) {
    return fail("malformed_next_event", (e as Error).message);
  }
  const nextChain = verifyEventChain(nextEvents);
  if (!nextChain.ok) {
    return {
      ok: false,
      issues: nextChain.issues.map((i) => ({
        code: `next_chain_${i.code}`,
        message: i.message,
      })),
    };
  }

  // Fold before persistence — reject invalid lifecycle before any CAS write.
  const fold = foldTaskState(nextEvents);
  if (!fold.ok) {
    return {
      ok: false,
      issues: fold.issues.map((i) => ({
        code: `fold_${i.code}`,
        message: i.message,
      })),
    };
  }

  const cas = await mutable.value.unsafeCompareAndSwap(
    input.expectedTip,
    next,
  );
  if (!cas.ok) {
    return fail(cas.code, cas.message);
  }

  return {
    ok: true,
    value: {
      tip: cas.tip,
      event,
      eventPath,
      objects: cas.objects,
    },
  };
}

/**
 * Append an operational control event under CAS + integrity rules (spec §4.5).
 * Rejects privileged / founder-only event types.
 * Does not silently retry on stale tip.
 */
export async function appendControlEvent(
  input: AppendEventInput,
): Promise<LedgerResult<AppendEventSuccess>> {
  return commitControlEvent({
    store: input.store,
    expectedTip: input.expectedTip,
    taskId: input.taskId,
    eventType: input.eventType,
    payload: input.payload,
    occurredAt: input.occurredAt,
    actor: input.actor,
    claimedActiveContractVersion: input.claimedActiveContractVersion,
    claimedActiveContractDigest: input.claimedActiveContractDigest,
    allowPrivileged: false,
  });
}

/** @internal Privileged commit for dedicated APIs only. */
export async function commitPrivilegedControlEvent(
  input: Omit<InternalCommitInput, "allowPrivileged">,
): Promise<LedgerResult<AppendEventSuccess>> {
  return commitControlEvent({ ...input, allowPrivileged: true });
}

export type StageContractInput = {
  store: ControlStore;
  expectedTip: ControlTip;
  taskId: string;
  contractVersion: number;
  contractYaml: string;
  occurredAt: string;
  actor?: ControlEvent["actor"];
};

/**
 * Stage canonical contract bytes under proposed/ and append contract_staged.
 * Destination path task/version must match YAML contents.
 */
export async function stageContract(
  input: StageContractInput,
): Promise<
  LedgerResult<AppendEventSuccess & { proposedPath: string; digest: string }>
> {
  let digest: string;
  let parsed;
  try {
    assertCanonicalContractYaml(input.contractYaml);
    parsed = parseCanonicalContractYaml(input.contractYaml);
    digest = digestContractFileBytes(input.contractYaml);
  } catch (e) {
    return fail("invalid_contract", (e as Error).message);
  }

  if (parsed.task_id !== input.taskId) {
    return fail(
      "staged_path_task_mismatch",
      `contract.task_id ${parsed.task_id} != destination ${input.taskId}`,
    );
  }
  if (parsed.contract_version !== input.contractVersion) {
    return fail(
      "staged_path_version_mismatch",
      `contract.contract_version ${parsed.contract_version} != destination ${input.contractVersion}`,
    );
  }

  const proposedPath = formatProposedPath(input.taskId, input.contractVersion);
  const contractPath = formatContractPath(input.taskId, input.contractVersion);
  let snapshot;
  try {
    snapshot = await input.store.getSnapshot();
  } catch (e) {
    return fail(
      "integrity_failure",
      e instanceof Error ? e.message : String(e),
    );
  }
  if (snapshot.objects.has(contractPath)) {
    return fail(
      "contract_version_exists",
      `frozen contract already exists: ${contractPath}`,
    );
  }

  const result = await commitPrivilegedControlEvent({
    store: input.store,
    expectedTip: input.expectedTip,
    taskId: input.taskId,
    eventType: "contract_staged",
    payload: {
      contract_version: input.contractVersion,
      contract_digest: digest,
    },
    occurredAt: input.occurredAt,
    actor: input.actor ?? {
      kind: "orchestrator",
      provider: "phase-b-dry-run",
      session_or_run_id: "stage-contract",
      github_actor_id: null,
    },
    overrideActiveContract: {
      version: input.contractVersion,
      digest,
    },
    extraObjects: new Map([[proposedPath, input.contractYaml]]),
  });

  if (!result.ok) return result;
  return {
    ok: true,
    value: { ...result.value, proposedPath, digest },
  };
}

export type AddDerivedClosureInput = {
  store: ControlStore;
  expectedTip: ControlTip;
  path: string;
  content: string;
};

/**
 * Add/refresh a derived closure object (closures/** only) under CAS.
 * Does not rewrite authority objects.
 */
export async function addDerivedClosure(
  input: AddDerivedClosureInput,
): Promise<LedgerResult<{ tip: ControlTip; path: string }>> {
  if (!input.path.startsWith("closures/") || input.path.includes("..")) {
    return fail("invalid_derived_path", "path must be under closures/");
  }
  const mutable = requireMutable(input.store);
  if (!mutable.ok) return mutable;

  let snapshot;
  try {
    snapshot = await input.store.getSnapshot();
  } catch (e) {
    return fail(
      "integrity_failure",
      e instanceof Error ? e.message : String(e),
    );
  }
  if (snapshot.tip !== input.expectedTip) {
    return fail(
      "stale_tip",
      `expected tip ${input.expectedTip}, observed ${snapshot.tip}`,
    );
  }

  const next = cloneObjects(snapshot.objects);
  next.set(input.path, input.content);
  const delta = verifyProtectedObjectDelta(
    contentDigestMap(snapshot.objects),
    contentDigestMap(next),
  );
  if (!delta.ok) {
    return {
      ok: false,
      issues: delta.issues.map((i) => ({ code: i.code, message: i.message })),
    };
  }

  const cas = await mutable.value.unsafeCompareAndSwap(
    input.expectedTip,
    next,
  );
  if (!cas.ok) return fail(cas.code, cas.message);
  return { ok: true, value: { tip: cas.tip, path: input.path } };
}

export function readTaskEventChain(
  objects: ReadonlyMap<string, string>,
  taskId: string,
): LedgerResult<ControlEvent[]> {
  try {
    const events = listTaskEvents(objects, taskId);
    if (events.length === 0) {
      return fail("empty_chain", `no events for ${taskId}`);
    }
    const chain = verifyEventChain(events);
    if (!chain.ok) {
      return {
        ok: false,
        issues: chain.issues.map((i) => ({
          code: i.code,
          message: i.message,
        })),
      };
    }
    return { ok: true, value: chain.events };
  } catch (e) {
    return fail("malformed_event", (e as Error).message);
  }
}
