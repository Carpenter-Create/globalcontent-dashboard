import { digestContractFileBytes } from "./contract-digest";
import {
  type ControlStore,
  type ControlTip,
  cloneObjects,
  contentDigestMap,
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
import { verifyProtectedObjectDelta } from "./protected-delta";
import { assertCanonicalContractYaml } from "./contract-yaml";

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
   * Active contract pins for the new event.
   * For authorize, these must match the newly frozen contract.
   * For other events, must continue the chain's active contract.
   */
  activeContractVersion: number;
  activeContractDigest: string;
  /** Extra object writes applied in the same CAS (e.g. frozen contract bytes). */
  extraObjects?: Map<string, string>;
};

export type AppendEventSuccess = {
  tip: ControlTip;
  event: ControlEvent;
  eventPath: string;
  objects: ReadonlyMap<string, string>;
};

function fail<T = never>(code: string, message: string): LedgerResult<T> {
  return { ok: false, issues: [{ code, message }] };
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

/**
 * Append a control event under CAS + integrity rules (spec §4.5).
 * Does not silently retry on stale tip.
 */
export async function appendControlEvent(
  input: AppendEventInput,
): Promise<LedgerResult<AppendEventSuccess>> {
  const snapshot = await input.store.getSnapshot();
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

  const sequence = priorEvents.length + 1;
  const prev =
    sequence === 1
      ? genesisPrevEventDigest(input.taskId)
      : priorEvents[priorEvents.length - 1].event_digest;

  if (sequence > 1) {
    const last = priorEvents[priorEvents.length - 1];
    if (
      input.eventType !== "authorize" &&
      (input.activeContractVersion !== last.active_contract_version ||
        input.activeContractDigest !== last.active_contract_digest)
    ) {
      return fail(
        "active_contract_drift",
        "active contract pins must continue prior chain (only authorize may change them)",
      );
    }
  }

  let event: ControlEvent;
  try {
    const preimage = {
      schema_version: 1,
      task_id: input.taskId,
      sequence,
      event_type: input.eventType,
      occurred_at: input.occurredAt,
      actor: input.actor,
      active_contract_version: input.activeContractVersion,
      active_contract_digest: input.activeContractDigest,
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

  // Re-verify full task chain including new event
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

  const cas = await input.store.compareAndSwap(input.expectedTip, next);
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
 */
export async function stageContract(
  input: StageContractInput,
): Promise<LedgerResult<AppendEventSuccess & { proposedPath: string; digest: string }>> {
  let digest: string;
  try {
    assertCanonicalContractYaml(input.contractYaml);
    digest = digestContractFileBytes(input.contractYaml);
  } catch (e) {
    return fail("invalid_contract", (e as Error).message);
  }

  const proposedPath = formatProposedPath(input.taskId, input.contractVersion);
  const contractPath = formatContractPath(input.taskId, input.contractVersion);
  const snapshot = await input.store.getSnapshot();
  if (snapshot.objects.has(contractPath)) {
    return fail(
      "contract_version_exists",
      `frozen contract already exists: ${contractPath}`,
    );
  }

  // Active pins for contract_staged use the staged digest/version
  const result = await appendControlEvent({
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
    activeContractVersion: input.contractVersion,
    activeContractDigest: digest,
    extraObjects: new Map([[proposedPath, input.contractYaml]]),
  });

  if (!result.ok) return result;
  return {
    ok: true,
    value: { ...result.value, proposedPath, digest },
  };
}

export type FreezeContractInput = {
  store: ControlStore;
  expectedTip: ControlTip;
  taskId: string;
  contractVersion: number;
  /** If omitted, read from proposed path. */
  contractYaml?: string;
};

/**
 * Promote proposed contract bytes to create-once contracts/ path (no event).
 * Prefer bindFounderAuthorization which freezes + authorize atomically.
 */
export async function freezeContractBytes(
  input: FreezeContractInput,
): Promise<LedgerResult<{ tip: ControlTip; contractPath: string; digest: string }>> {
  const snapshot = await input.store.getSnapshot();
  if (snapshot.tip !== input.expectedTip) {
    return fail(
      "stale_tip",
      `expected tip ${input.expectedTip}, observed ${snapshot.tip}`,
    );
  }
  const proposedPath = formatProposedPath(input.taskId, input.contractVersion);
  const contractPath = formatContractPath(input.taskId, input.contractVersion);
  const yaml =
    input.contractYaml ?? (await input.store.readObject(proposedPath));
  if (!yaml) {
    return fail("missing_staged_contract", `missing ${proposedPath}`);
  }
  if (snapshot.objects.has(contractPath)) {
    const existing = snapshot.objects.get(contractPath)!;
    if (existing !== yaml) {
      return fail(
        "contract_digest_conflict",
        `frozen contract exists with different bytes: ${contractPath}`,
      );
    }
    return {
      ok: true,
      value: {
        tip: snapshot.tip,
        contractPath,
        digest: digestContractFileBytes(existing),
      },
    };
  }

  let digest: string;
  try {
    digest = digestContractFileBytes(yaml);
  } catch (e) {
    return fail("invalid_contract", (e as Error).message);
  }

  const next = cloneObjects(snapshot.objects);
  next.set(contractPath, yaml);
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
  const cas = await input.store.compareAndSwap(input.expectedTip, next);
  if (!cas.ok) return fail(cas.code, cas.message);
  return { ok: true, value: { tip: cas.tip, contractPath, digest } };
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
