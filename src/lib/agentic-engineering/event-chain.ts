import { computeEventDigest } from "./event-digest";
import { safeParseControlEvent, type ControlEvent } from "./event-schema";
import { genesisPrevEventDigest } from "./genesis";

export type EventChainIssue = {
  code: string;
  message: string;
  sequence?: number;
};

export type EventChainResult =
  | { ok: true; events: ControlEvent[] }
  | { ok: false; issues: EventChainIssue[] };

/**
 * Verify an ordered per-task event sequence (spec §4.5.4–§4.5.5).
 * Fail closed with structured issues.
 */
export function verifyEventChain(rawEvents: unknown[]): EventChainResult {
  const issues: EventChainIssue[] = [];
  if (rawEvents.length === 0) {
    return { ok: false, issues: [{ code: "empty", message: "event chain is empty" }] };
  }

  const events: ControlEvent[] = [];
  for (let i = 0; i < rawEvents.length; i += 1) {
    const parsed = safeParseControlEvent(rawEvents[i]);
    if (!parsed.success) {
      issues.push({
        code: "malformed_event",
        message: parsed.error.issues.map((x) => x.message).join("; ") || "malformed",
        sequence: i + 1,
      });
      continue;
    }
    events.push(parsed.data);
  }
  if (issues.length > 0) return { ok: false, issues };

  const taskId = events[0].task_id;
  let activeVersion = events[0].active_contract_version;
  let activeDigest = events[0].active_contract_digest;
  /** Once authorize appears, only further authorize may change active pins. */
  let hasAuthorized = false;

  if (events[0].sequence !== 1) {
    issues.push({
      code: "bad_genesis",
      message: "chain must start at sequence 1",
      sequence: events[0].sequence,
    });
  }

  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    const expectedSeq = i + 1;
    if (ev.sequence !== expectedSeq) {
      issues.push({
        code: "sequence_gap",
        message: `expected sequence ${expectedSeq}, got ${ev.sequence}`,
        sequence: ev.sequence,
      });
    }
    if (ev.task_id !== taskId) {
      issues.push({
        code: "task_id_mismatch",
        message: `task_id changed from ${taskId} to ${ev.task_id}`,
        sequence: ev.sequence,
      });
    }

    const expectedPrev =
      expectedSeq === 1
        ? genesisPrevEventDigest(taskId)
        : events[i - 1].event_digest;
    if (ev.prev_event_digest !== expectedPrev) {
      issues.push({
        code:
          expectedSeq === 1 && ev.prev_event_digest !== genesisPrevEventDigest(taskId)
            ? "bad_genesis"
            : "prev_digest_mismatch",
        message: `prev_event_digest mismatch at sequence ${ev.sequence}`,
        sequence: ev.sequence,
      });
    }

    const recomputed = computeEventDigest(ev);
    if (recomputed !== ev.event_digest) {
      issues.push({
        code: "event_digest_mismatch",
        message: `event_digest does not recompute at sequence ${ev.sequence}`,
        sequence: ev.sequence,
      });
    }

    if (ev.event_type === "authorize") {
      if (
        ev.payload.contract_version !== ev.active_contract_version ||
        ev.payload.contract_digest !== ev.active_contract_digest
      ) {
        issues.push({
          code: "authorize_digest_bind",
          message: "authorize payload must bind active_contract_* fields",
          sequence: ev.sequence,
        });
      }
      if (i > 0 && ev.active_contract_version < activeVersion) {
        issues.push({
          code: "contract_version_regression",
          message: "active_contract_version must not decrease",
          sequence: ev.sequence,
        });
      }
      activeVersion = ev.active_contract_version;
      activeDigest = ev.active_contract_digest;
      hasAuthorized = true;
    } else if (ev.event_type === "contract_staged" && !hasAuthorized) {
      // Pre-authorization: proposed identity may advance via explicit stage.
      // contract_staged is not founder authorization.
      if (
        ev.payload.contract_version !== ev.active_contract_version ||
        ev.payload.contract_digest !== ev.active_contract_digest
      ) {
        issues.push({
          code: "staged_digest_bind",
          message:
            "contract_staged payload must bind active_contract_* fields (proposed identity)",
          sequence: ev.sequence,
        });
      }
      if (i > 0 && ev.active_contract_version < activeVersion) {
        issues.push({
          code: "contract_version_regression",
          message: "active_contract_version must not decrease",
          sequence: ev.sequence,
        });
      }
      activeVersion = ev.active_contract_version;
      activeDigest = ev.active_contract_digest;
    } else if (
      ev.active_contract_version !== activeVersion ||
      ev.active_contract_digest !== activeDigest
    ) {
      issues.push({
        code: "active_contract_drift",
        message: hasAuthorized
          ? "active_contract_* changed without authorize event (authorized identity immutable)"
          : "active_contract_* changed without authorize or pre-auth contract_staged",
        sequence: ev.sequence,
      });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, events };
}
