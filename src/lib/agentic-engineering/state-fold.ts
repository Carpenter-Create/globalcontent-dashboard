import { verifyEventChain } from "./event-chain";
import type { ControlEventType } from "./event-schema";

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

/** Primary transitions driven by event_type (Phase A minimal table). */
const PRIMARY: Partial<
  Record<ControlEventType, { from: TaskState[] | "*"; to: TaskState }>
> = {
  contract_staged: {
    from: ["DRAFT", "FOUNDER_AUTHORIZATION_REQUIRED"],
    to: "FOUNDER_AUTHORIZATION_REQUIRED",
  },
  authorize: {
    from: ["FOUNDER_AUTHORIZATION_REQUIRED"],
    to: "AUTHORIZED",
  },
  implementation_started: {
    from: ["AUTHORIZED", "IMPLEMENTING", "FOUNDER_DECISION_REQUIRED"],
    to: "IMPLEMENTING",
  },
  implementation_declared: {
    from: ["IMPLEMENTING", "REMEDIATING"],
    to: "VALIDATING",
  },
  validation_completed: {
    from: ["VALIDATING"],
    to: "REVIEWING", // success path; failure uses remediation_required
  },
  review_started: { from: ["REVIEWING", "VALIDATING"], to: "REVIEWING" },
  review_completed: { from: ["REVIEWING"], to: "FOUNDER_REVIEW" },
  remediation_required: {
    from: ["VALIDATING", "REVIEWING", "FOUNDER_REVIEW"],
    to: "REMEDIATION_REQUIRED",
  },
  remediation_started: { from: ["REMEDIATION_REQUIRED"], to: "REMEDIATING" },
  founder_decision_required: {
    from: [
      "IMPLEMENTING",
      "VALIDATING",
      "REVIEWING",
      "REMEDIATION_REQUIRED",
      "REMEDIATING",
      "FOUNDER_REVIEW",
    ],
    to: "FOUNDER_DECISION_REQUIRED",
  },
  finding_disposition: {
    from: ["FOUNDER_DECISION_REQUIRED", "REVIEWING"],
    to: "FOUNDER_DECISION_REQUIRED",
  },
  stale_review: {
    from: ["FOUNDER_REVIEW", "REVIEWING", "VALIDATING"],
    to: "VALIDATING",
  },
  closure_invalidated: {
    from: ["FOUNDER_REVIEW"],
    to: "VALIDATING",
  },
  founder_review_ready: { from: ["REVIEWING"], to: "FOUNDER_REVIEW" },
  blocked: { from: "*", to: "BLOCKED" },
  critical_failure: { from: "*", to: "CRITICAL_FAILURE" },
  paused: { from: "*", to: "PAUSED" },
  resumed: { from: ["PAUSED"], to: "AUTHORIZED" }, // overwritten with pauseReturnState
  cancelled: { from: "*", to: "CANCELLED" },
  closed: { from: ["FOUNDER_REVIEW"], to: "CLOSED" },
};

function canTransition(from: TaskState, ruleFrom: TaskState[] | "*"): boolean {
  if (ruleFrom === "*") {
    return from !== "CLOSED" && from !== "CANCELLED";
  }
  return ruleFrom.includes(from);
}

/**
 * Deterministic state fold over a valid event chain.
 * Rejects impossible transitions. Does not perform orchestration side effects.
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
      return {
        ok: false,
        issues: [
          {
            code: "terminal_append",
            message: `cannot apply ${ev.event_type} after terminal state ${state.state}`,
          },
        ],
      };
    }

    const rule = PRIMARY[ev.event_type];
    if (!rule) {
      return {
        ok: false,
        issues: [
          {
            code: "unknown_event",
            message: `no fold rule for ${ev.event_type}`,
          },
        ],
      };
    }

    // validation_completed may fail → remediation via separate event; if payload.ok === false
    // require remediation_required instead of auto REVIEWING.
    if (
      ev.event_type === "validation_completed" &&
      ev.payload &&
      (ev.payload as { ok?: unknown }).ok === false
    ) {
      if (!canTransition(state.state, ["VALIDATING"])) {
        return {
          ok: false,
          issues: [
            {
              code: "invalid_transition",
              message: `validation_completed(failure) from ${state.state}`,
            },
          ],
        };
      }
      state = {
        ...state,
        state: "REMEDIATION_REQUIRED",
        taskId: ev.task_id,
        activeContractVersion: ev.active_contract_version,
        activeContractDigest: ev.active_contract_digest,
        lastEventSequence: ev.sequence,
        evidence: {
          lastEventType: ev.event_type,
          eventCount: state.evidence.eventCount + 1,
        },
      };
      continue;
    }

    // review_completed with changes_requested → remediation
    if (
      ev.event_type === "review_completed" &&
      (ev.payload as { status?: string }).status === "changes_requested"
    ) {
      if (!canTransition(state.state, ["REVIEWING"])) {
        return {
          ok: false,
          issues: [
            {
              code: "invalid_transition",
              message: `review_completed(changes_requested) from ${state.state}`,
            },
          ],
        };
      }
      state = {
        ...state,
        state: "REMEDIATION_REQUIRED",
        reviewStatus: "changes_requested",
        reviewedSha: null,
        taskId: ev.task_id,
        activeContractVersion: ev.active_contract_version,
        activeContractDigest: ev.active_contract_digest,
        lastEventSequence: ev.sequence,
        evidence: {
          lastEventType: ev.event_type,
          eventCount: state.evidence.eventCount + 1,
        },
      };
      continue;
    }

    if (!canTransition(state.state, rule.from)) {
      return {
        ok: false,
        issues: [
          {
            code: "invalid_transition",
            message: `cannot apply ${ev.event_type} from ${state.state}`,
          },
        ],
      };
    }

    let nextState = rule.to;
    let pauseReturn = state.pauseReturnState;
    if (ev.event_type === "paused") {
      pauseReturn = state.state;
    }
    if (ev.event_type === "resumed") {
      nextState = state.pauseReturnState ?? "AUTHORIZED";
      pauseReturn = null;
    }

    const payload = ev.payload as Record<string, unknown>;
    let implementationSha = state.implementationSha;
    let validatedSha = state.validatedSha;
    let reviewedSha = state.reviewedSha;
    let reviewStatus = state.reviewStatus;
    let remediationCount = state.remediationCount;
    let prNumber = state.prNumber;

    if (ev.event_type === "implementation_declared") {
      implementationSha =
        typeof payload.implementation_sha === "string"
          ? payload.implementation_sha
          : implementationSha;
      if (typeof payload.pr_number === "number") prNumber = payload.pr_number;
      validatedSha = null;
      reviewedSha = null;
      reviewStatus = "none";
    }
    if (ev.event_type === "validation_completed" && payload.ok !== false) {
      validatedSha =
        typeof payload.validated_sha === "string"
          ? payload.validated_sha
          : validatedSha;
    }
    if (
      ev.event_type === "review_completed" &&
      (payload.status === "approved" || payload.status === undefined)
    ) {
      reviewedSha =
        typeof payload.reviewed_sha === "string"
          ? payload.reviewed_sha
          : reviewedSha;
      reviewStatus = "approved";
    }
    if (ev.event_type === "remediation_started") {
      remediationCount += 1;
      implementationSha = null;
      validatedSha = null;
      reviewedSha = null;
      reviewStatus = "stale";
    }
    if (
      ev.event_type === "stale_review" ||
      ev.event_type === "closure_invalidated"
    ) {
      reviewedSha = null;
      reviewStatus = "stale";
      validatedSha = null;
    }
    if (ev.event_type === "remediation_started" || ev.event_type === "implementation_started") {
      if (typeof payload.pr_number === "number") prNumber = payload.pr_number;
    }

    state = {
      state: nextState,
      taskId: ev.task_id,
      activeContractVersion: ev.active_contract_version,
      activeContractDigest: ev.active_contract_digest,
      implementationSha,
      validatedSha,
      reviewedSha,
      reviewStatus,
      remediationCount,
      prNumber,
      pauseReturnState: pauseReturn,
      lastEventSequence: ev.sequence,
      evidence: {
        lastEventType: ev.event_type,
        eventCount: state.evidence.eventCount + 1,
      },
    };
  }

  return { ok: true, state };
}

export function initialFoldedState(): FoldedTaskState {
  return {
    ...INITIAL,
    evidence: { ...INITIAL.evidence },
  };
}
