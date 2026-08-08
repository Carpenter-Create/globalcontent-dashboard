import { verifyEventChain } from "./event-chain";
import type { ControlEvent, ControlEventType } from "./event-schema";

export const TASK_STATES = [
  "DRAFT",
  "FOUNDER_AUTHORIZATION_REQUIRED",
  "AUTHORIZED",
  "IMPLEMENTING",
  "VALIDATING",
  "REVIEWING",
  "REMEDIATION_REQUIRED",
  "REMEDIATING",
  "FOUNDER_REVIEW",
  "FOUNDER_DECISION_REQUIRED",
  "BLOCKED",
  "CRITICAL_FAILURE",
  "PAUSED",
  "CLOSED",
  "CANCELLED",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export type FoldedTaskState = {
  state: TaskState;
  taskId: string | null;
  activeContractVersion: number | null;
  activeContractDigest: string | null;
  implementationSha: string | null;
  validatedSha: string | null;
  reviewedSha: string | null;
  reviewStatus: "none" | "pending" | "approved" | "changes_requested" | "stale";
  remediationCount: number;
  prNumber: number | null;
  pauseReturnState: TaskState | null;
  lastEventSequence: number;
  evidence: {
    lastEventType: ControlEventType | null;
    eventCount: number;
  };
};

export type FoldResult =
  | { ok: true; state: FoldedTaskState }
  | { ok: false; issues: { code: string; message: string }[] };

const INITIAL: FoldedTaskState = {
  state: "DRAFT",
  taskId: null,
  activeContractVersion: null,
  activeContractDigest: null,
  implementationSha: null,
  validatedSha: null,
  reviewedSha: null,
  reviewStatus: "none",
  remediationCount: 0,
  prNumber: null,
  pauseReturnState: null,
  lastEventSequence: 0,
  evidence: { lastEventType: null, eventCount: 0 },
};

function fail(code: string, message: string): FoldResult {
  return { ok: false, issues: [{ code, message }] };
}

function canFrom(from: TaskState, allowed: TaskState[] | "*"): boolean {
  if (allowed === "*") return from !== "CLOSED" && from !== "CANCELLED";
  return allowed.includes(from);
}

function applyMeta(
  state: FoldedTaskState,
  ev: ControlEvent,
  nextState: TaskState,
  patch: Partial<FoldedTaskState> = {},
): FoldedTaskState {
  return {
    ...state,
    ...patch,
    state: nextState,
    taskId: ev.task_id,
    activeContractVersion: ev.active_contract_version,
    activeContractDigest: ev.active_contract_digest,
    lastEventSequence: ev.sequence,
    evidence: {
      lastEventType: ev.event_type,
      eventCount: state.evidence.eventCount + 1,
    },
  };
}

/**
 * Deterministic state fold. Does not synthesize success from missing fields —
 * payloads are schema-validated by the event chain first.
 *
 * `review_completed` never enters FOUNDER_REVIEW; only `founder_review_ready` does.
 */
export function foldTaskState(rawEvents: unknown[]): FoldResult {
  const chain = verifyEventChain(rawEvents);
  if (!chain.ok) {
    return {
      ok: false,
      issues: chain.issues.map((i) => ({ code: i.code, message: i.message })),
    };
  }

  let state: FoldedTaskState = { ...INITIAL, evidence: { ...INITIAL.evidence } };

  for (const ev of chain.events) {
    if (state.state === "CLOSED" || state.state === "CANCELLED") {
      return fail(
        "terminal_append",
        `cannot apply ${ev.event_type} after terminal state ${state.state}`,
      );
    }

    switch (ev.event_type) {
      case "contract_staged": {
        if (!canFrom(state.state, ["DRAFT", "FOUNDER_AUTHORIZATION_REQUIRED"])) {
          return fail("invalid_transition", `contract_staged from ${state.state}`);
        }
        state = applyMeta(state, ev, "FOUNDER_AUTHORIZATION_REQUIRED");
        break;
      }
      case "authorize": {
        if (!canFrom(state.state, ["FOUNDER_AUTHORIZATION_REQUIRED"])) {
          return fail("invalid_transition", `authorize from ${state.state}`);
        }
        if (
          ev.payload.contract_version !== ev.active_contract_version ||
          ev.payload.contract_digest !== ev.active_contract_digest
        ) {
          return fail(
            "authorize_bind_mismatch",
            "authorize payload must match active_contract_*",
          );
        }
        state = applyMeta(state, ev, "AUTHORIZED");
        break;
      }
      case "implementation_started": {
        if (
          !canFrom(state.state, [
            "AUTHORIZED",
            "IMPLEMENTING",
            "FOUNDER_DECISION_REQUIRED",
          ])
        ) {
          return fail(
            "invalid_transition",
            `implementation_started from ${state.state}`,
          );
        }
        state = applyMeta(state, ev, "IMPLEMENTING", {
          prNumber: ev.payload.pr_number ?? state.prNumber,
        });
        break;
      }
      case "implementation_declared": {
        if (!canFrom(state.state, ["IMPLEMENTING", "REMEDIATING"])) {
          return fail(
            "invalid_transition",
            `implementation_declared from ${state.state}`,
          );
        }
        state = applyMeta(state, ev, "VALIDATING", {
          implementationSha: ev.payload.implementation_sha,
          prNumber: ev.payload.pr_number,
          validatedSha: null,
          reviewedSha: null,
          reviewStatus: "none",
        });
        break;
      }
      case "validation_completed": {
        if (!canFrom(state.state, ["VALIDATING"])) {
          return fail(
            "invalid_transition",
            `validation_completed from ${state.state}`,
          );
        }
        if (ev.payload.outcome === "success") {
          if (ev.payload.validated_sha !== state.implementationSha) {
            return fail(
              "validated_sha_mismatch",
              "validated_sha must equal declared implementation_sha",
            );
          }
          state = applyMeta(state, ev, "REVIEWING", {
            validatedSha: ev.payload.validated_sha,
          });
        } else {
          state = applyMeta(state, ev, "REMEDIATION_REQUIRED", {
            validatedSha: null,
          });
        }
        break;
      }
      case "review_started": {
        if (!canFrom(state.state, ["REVIEWING", "VALIDATING"])) {
          return fail("invalid_transition", `review_started from ${state.state}`);
        }
        if (
          state.validatedSha &&
          ev.payload.target_sha !== state.validatedSha
        ) {
          return fail(
            "review_target_mismatch",
            "review target_sha must match validated_sha",
          );
        }
        state = applyMeta(state, ev, "REVIEWING", { reviewStatus: "pending" });
        break;
      }
      case "review_completed": {
        if (!canFrom(state.state, ["REVIEWING"])) {
          return fail(
            "invalid_transition",
            `review_completed from ${state.state}`,
          );
        }
        if (ev.payload.status === "approved") {
          if (ev.payload.reviewed_sha !== state.validatedSha) {
            return fail(
              "reviewed_sha_mismatch",
              "reviewed_sha must equal validated_sha",
            );
          }
          // Remain in REVIEWING — only founder_review_ready enters FOUNDER_REVIEW.
          state = applyMeta(state, ev, "REVIEWING", {
            reviewedSha: ev.payload.reviewed_sha,
            reviewStatus: "approved",
          });
        } else {
          state = applyMeta(state, ev, "REMEDIATION_REQUIRED", {
            reviewedSha: null,
            reviewStatus: "changes_requested",
          });
        }
        break;
      }
      case "remediation_required": {
        if (
          !canFrom(state.state, [
            "VALIDATING",
            "REVIEWING",
            "FOUNDER_REVIEW",
          ])
        ) {
          return fail(
            "invalid_transition",
            `remediation_required from ${state.state}`,
          );
        }
        state = applyMeta(state, ev, "REMEDIATION_REQUIRED");
        break;
      }
      case "remediation_started": {
        if (!canFrom(state.state, ["REMEDIATION_REQUIRED"])) {
          return fail(
            "invalid_transition",
            `remediation_started from ${state.state}`,
          );
        }
        state = applyMeta(state, ev, "REMEDIATING", {
          remediationCount: state.remediationCount + 1,
          implementationSha: null,
          validatedSha: null,
          reviewedSha: null,
          reviewStatus: "stale",
        });
        break;
      }
      case "founder_decision_required": {
        if (
          !canFrom(state.state, [
            "IMPLEMENTING",
            "VALIDATING",
            "REVIEWING",
            "REMEDIATION_REQUIRED",
            "REMEDIATING",
            "FOUNDER_REVIEW",
          ])
        ) {
          return fail(
            "invalid_transition",
            `founder_decision_required from ${state.state}`,
          );
        }
        state = applyMeta(state, ev, "FOUNDER_DECISION_REQUIRED");
        break;
      }
      case "finding_disposition": {
        if (!canFrom(state.state, ["FOUNDER_DECISION_REQUIRED", "REVIEWING"])) {
          return fail(
            "invalid_transition",
            `finding_disposition from ${state.state}`,
          );
        }
        // Disposition is control-plane evidence, not a state demotion.
        // Preserve REVIEWING so founder_review_ready remains reachable after
        // an Important waiver while review is already approved.
        state = applyMeta(state, ev, state.state);
        break;
      }
      case "stale_review": {
        if (!canFrom(state.state, ["FOUNDER_REVIEW", "REVIEWING", "VALIDATING"])) {
          return fail("invalid_transition", `stale_review from ${state.state}`);
        }
        state = applyMeta(state, ev, "VALIDATING", {
          reviewedSha: null,
          validatedSha: null,
          reviewStatus: "stale",
        });
        break;
      }
      case "closure_invalidated": {
        if (!canFrom(state.state, ["FOUNDER_REVIEW"])) {
          return fail(
            "invalid_transition",
            `closure_invalidated from ${state.state}`,
          );
        }
        state = applyMeta(state, ev, "VALIDATING", {
          reviewedSha: null,
          validatedSha: null,
          reviewStatus: "stale",
        });
        break;
      }
      case "founder_review_ready": {
        if (!canFrom(state.state, ["REVIEWING"])) {
          return fail(
            "invalid_transition",
            `founder_review_ready from ${state.state}`,
          );
        }
        if (state.reviewStatus !== "approved") {
          return fail(
            "review_not_approved",
            "founder_review_ready requires approved review",
          );
        }
        const p = ev.payload;
        if (
          p.implementation_sha !== state.implementationSha ||
          p.validated_sha !== state.validatedSha ||
          p.reviewed_sha !== state.reviewedSha ||
          p.active_contract_version !== ev.active_contract_version ||
          p.active_contract_digest !== ev.active_contract_digest ||
          !(
            p.implementation_sha === p.validated_sha &&
            p.validated_sha === p.reviewed_sha
          )
        ) {
          return fail(
            "founder_review_ready_mismatch",
            "founder_review_ready SHA/contract pins do not match fold state",
          );
        }
        state = applyMeta(state, ev, "FOUNDER_REVIEW");
        break;
      }
      case "blocked": {
        if (!canFrom(state.state, "*")) {
          return fail("invalid_transition", `blocked from ${state.state}`);
        }
        state = applyMeta(state, ev, "BLOCKED");
        break;
      }
      case "critical_failure": {
        if (!canFrom(state.state, "*")) {
          return fail(
            "invalid_transition",
            `critical_failure from ${state.state}`,
          );
        }
        state = applyMeta(state, ev, "CRITICAL_FAILURE");
        break;
      }
      case "paused": {
        if (!canFrom(state.state, "*")) {
          return fail("invalid_transition", `paused from ${state.state}`);
        }
        state = applyMeta(state, ev, "PAUSED", {
          pauseReturnState: state.state,
        });
        break;
      }
      case "resumed": {
        if (!canFrom(state.state, ["PAUSED"])) {
          return fail("invalid_transition", `resumed from ${state.state}`);
        }
        state = applyMeta(state, ev, state.pauseReturnState ?? "AUTHORIZED", {
          pauseReturnState: null,
        });
        break;
      }
      case "cancelled": {
        if (!canFrom(state.state, "*")) {
          return fail("invalid_transition", `cancelled from ${state.state}`);
        }
        state = applyMeta(state, ev, "CANCELLED");
        break;
      }
      case "closed": {
        if (!canFrom(state.state, ["FOUNDER_REVIEW"])) {
          return fail("invalid_transition", `closed from ${state.state}`);
        }
        state = applyMeta(state, ev, "CLOSED");
        break;
      }
      default: {
        const _exhaustive: never = ev;
        void _exhaustive;
        return fail("unknown_event", "unreachable");
      }
    }
  }

  return { ok: true, state };
}

export function initialFoldedState(): FoldedTaskState {
  return {
    ...INITIAL,
    evidence: { ...INITIAL.evidence },
  };
}
