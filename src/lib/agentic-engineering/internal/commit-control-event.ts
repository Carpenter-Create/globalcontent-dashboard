/**
 * Internal trusted commit path. Not part of the package public index.
 */
import {
  type ControlStore,
  type ControlTip,
  cloneObjects,
  contentDigestMap,
} from "../control-store";
import {
  formatEventPath,
  parseEventPath,
} from "../control-paths";
import { verifyEventChain } from "../event-chain";
import { withEventDigest } from "../event-digest";
import type {
  ControlEvent,
  ControlEventPreimage,
  ControlEventType,
} from "../event-schema";
import { genesisPrevEventDigest } from "../genesis";
import {
  isOperationalEventType,
  isPrivilegedEventType,
} from "../privileged-events";
import { verifyProtectedObjectDelta } from "../protected-delta";
import { foldTaskState } from "../state-fold";
import { getWritableControlOps } from "./writable-registry";

export type LedgerIssue = { code: string; message: string };

export type LedgerResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: LedgerIssue[] };

export type AppendEventSuccess = {
  tip: ControlTip;
  event: ControlEvent;
  eventPath: string;
  objects: ReadonlyMap<string, string>;
};

export type PrivilegedCommitInput = {
  store: ControlStore;
  expectedTip: ControlTip;
  taskId: string;
  eventType: ControlEventType;
  payload: Record<string, unknown>;
  occurredAt: string;
  actor: ControlEvent["actor"];
  overrideActiveContract?: { version: number; digest: string };
  claimedActiveContractVersion?: number;
  claimedActiveContractDigest?: string;
  extraObjects?: Map<string, string>;
};

type InternalCommitInput = PrivilegedCommitInput & {
  allowPrivileged: boolean;
};

function fail<T = never>(code: string, message: string): LedgerResult<T> {
  return { ok: false, issues: [{ code, message }] };
}

function requireWritable(store: ControlStore) {
  const ops = getWritableControlOps(store);
  if (!ops) {
    return fail(
      "store_not_writable",
      "control store is not registered as a writable ledger store",
    );
  }
  return { ok: true as const, value: ops };
}

export function listTaskEvents(
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

  const writable = requireWritable(input.store);
  if (!writable.ok) return writable;

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

  const cas = await writable.value.unsafeCompareAndSwap(
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

export async function commitOperationalControlEvent(
  input: Omit<PrivilegedCommitInput, "overrideActiveContract" | "extraObjects"> & {
    claimedActiveContractVersion?: number;
    claimedActiveContractDigest?: string;
  },
): Promise<LedgerResult<AppendEventSuccess>> {
  return commitControlEvent({
    ...input,
    allowPrivileged: false,
  });
}

/** Dedicated-API-only privileged commit — not re-exported from package index. */
export async function commitPrivilegedControlEvent(
  input: PrivilegedCommitInput,
): Promise<LedgerResult<AppendEventSuccess>> {
  return commitControlEvent({ ...input, allowPrivileged: true });
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
