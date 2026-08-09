import { CONFIGURED_FOUNDER_GITHUB_ACTOR_ID } from "./closure-readiness";
import type { ClosureReadinessResult } from "./closure-readiness";
import type { AppendEventSuccess, LedgerResult } from "./control-ledger";
import { commitPrivilegedControlEvent } from "./internal/commit-control-event";
import type { ControlStore, ControlTip } from "./control-store";
import type { ControlEvent } from "./event-schema";

export type FounderAuthorityContext = {
  store: ControlStore;
  expectedTip: ControlTip;
  taskId: string;
  occurredAt: string;
  /**
   * Observed founder GitHub actor ID. Must equal the configured repository
   * founder identity. Payload founder IDs alone are never authority.
   */
  observedFounderActorId: number;
  /** Optional session identity for the dry-run actor envelope. */
  sessionOrRunId?: string;
};

function fail<T = never>(code: string, message: string): LedgerResult<T> {
  return { ok: false, issues: [{ code, message }] };
}

function requireFounderActor(
  observed: number,
): LedgerResult<{ actorId: number }> {
  if (
    typeof observed !== "number" ||
    !Number.isSafeInteger(observed) ||
    observed !== CONFIGURED_FOUNDER_GITHUB_ACTOR_ID
  ) {
    return fail(
      "founder_actor_mismatch",
      `observed founder actor ${observed} != configured ${CONFIGURED_FOUNDER_GITHUB_ACTOR_ID}`,
    );
  }
  return { ok: true, value: { actorId: observed } };
}

function founderActor(
  actorId: number,
  sessionOrRunId: string,
): ControlEvent["actor"] {
  return {
    kind: "founder",
    provider: "github",
    session_or_run_id: sessionOrRunId,
    github_actor_id: actorId,
  };
}

async function commitFounderEvent(
  ctx: FounderAuthorityContext,
  eventType: ControlEvent["event_type"],
  payload: Record<string, unknown>,
): Promise<LedgerResult<AppendEventSuccess>> {
  const founder = requireFounderActor(ctx.observedFounderActorId);
  if (!founder.ok) return founder;

  return commitPrivilegedControlEvent({
    store: ctx.store,
    expectedTip: ctx.expectedTip,
    taskId: ctx.taskId,
    eventType,
    payload,
    occurredAt: ctx.occurredAt,
    actor: founderActor(
      founder.value.actorId,
      ctx.sessionOrRunId ?? `founder-${eventType}`,
    ),
  });
}

export async function recordFounderFindingDisposition(
  input: FounderAuthorityContext & {
    findingId: string;
    disposition: "accepted_by_founder" | "deferred" | "wont_fix_founder";
  },
): Promise<LedgerResult<AppendEventSuccess>> {
  return commitFounderEvent(input, "finding_disposition", {
    finding_id: input.findingId,
    disposition: input.disposition,
    founder_actor_id: input.observedFounderActorId,
  });
}

export async function recordFounderPause(
  input: FounderAuthorityContext & { reason: string },
): Promise<LedgerResult<AppendEventSuccess>> {
  return commitFounderEvent(input, "paused", {
    reason: input.reason,
    founder_actor_id: input.observedFounderActorId,
  });
}

export async function recordFounderResume(
  input: FounderAuthorityContext,
): Promise<LedgerResult<AppendEventSuccess>> {
  return commitFounderEvent(input, "resumed", {
    founder_actor_id: input.observedFounderActorId,
  });
}

export async function recordFounderCancel(
  input: FounderAuthorityContext & { reason: string },
): Promise<LedgerResult<AppendEventSuccess>> {
  return commitFounderEvent(input, "cancelled", {
    reason: input.reason,
    founder_actor_id: input.observedFounderActorId,
  });
}

export async function recordFounderClose(
  input: FounderAuthorityContext & { mergeSha: string },
): Promise<LedgerResult<AppendEventSuccess>> {
  return commitFounderEvent(input, "closed", {
    merge_sha: input.mergeSha,
    founder_actor_id: input.observedFounderActorId,
  });
}

/**
 * Record founder_review_ready only when a verified closure-readiness result
 * is ready. Does not perform live GitHub verification in Phase B.
 */
export async function recordFounderReviewReady(
  input: FounderAuthorityContext & {
    closureReadiness: ClosureReadinessResult;
    payload: {
      implementation_sha: string;
      validated_sha: string;
      reviewed_sha: string;
      active_contract_version: number;
      active_contract_digest: string;
      closure_evidence_ref: string;
      predicate_result_id: string;
    };
  },
): Promise<LedgerResult<AppendEventSuccess>> {
  if (!input.closureReadiness.ready) {
    return fail(
      "closure_not_ready",
      `founder_review_ready requires verified ready closure (reasons: ${input.closureReadiness.reasons.join(",")})`,
    );
  }
  return commitFounderEvent(input, "founder_review_ready", input.payload);
}
