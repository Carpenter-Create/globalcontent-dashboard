import { gitShaSchema } from "./contract-schema";

function requireSha(label: string, sha: string): string {
  const r = gitShaSchema.safeParse(sha);
  if (!r.success) {
    throw new Error(`${label} must be a 40-char lowercase hex git SHA`);
  }
  return r.data;
}

/** implementation_declared payload helper. */
export function buildImplementationDeclaredPayload(input: {
  implementationSha: string;
  prNumber: number;
  sessionOrRunId: string;
}) {
  return {
    implementation_sha: requireSha("implementationSha", input.implementationSha),
    pr_number: input.prNumber,
    session_or_run_id: input.sessionOrRunId,
  };
}

/** validation_completed payload helper. */
export function buildValidationCompletedPayload(input: {
  outcome: "success" | "failure";
  validatedSha: string;
  evidenceRefs: { kind: "check_run" | "log" | "artifact" | "note"; id: string }[];
}) {
  if (!input.evidenceRefs.length) {
    throw new Error("validation evidence_refs must be non-empty");
  }
  return {
    outcome: input.outcome,
    validated_sha: requireSha("validatedSha", input.validatedSha),
    evidence_refs: input.evidenceRefs,
  };
}

/** review_started payload helper. */
export function buildReviewStartedPayload(input: {
  targetSha: string;
  sessionOrRunId: string;
  provider: string;
}) {
  return {
    target_sha: requireSha("targetSha", input.targetSha),
    session_or_run_id: input.sessionOrRunId,
    provider: input.provider,
  };
}

/** review_completed payload helper. */
export function buildReviewCompletedPayload(input: {
  reviewedSha: string;
  status: "approved" | "changes_requested";
  sessionOrRunId: string;
  provider: string;
  evidenceRef: string;
}) {
  return {
    reviewed_sha: requireSha("reviewedSha", input.reviewedSha),
    status: input.status,
    session_or_run_id: input.sessionOrRunId,
    provider: input.provider,
    evidence_ref: input.evidenceRef,
  };
}

/** stale_review / head-move invalidation helper. */
export function buildStaleReviewPayload(input: {
  priorReviewedSha: string;
  currentHeadSha: string;
}) {
  const prior = requireSha("priorReviewedSha", input.priorReviewedSha);
  const current = requireSha("currentHeadSha", input.currentHeadSha);
  if (prior === current) {
    throw new Error("stale_review requires distinct prior and current SHAs");
  }
  return {
    prior_reviewed_sha: prior,
    current_head_sha: current,
  };
}

/** closure_invalidated helper. */
export function buildClosureInvalidatedPayload(input: {
  priorHeadSha: string;
  currentHeadSha: string;
  reason: string;
}) {
  const prior = requireSha("priorHeadSha", input.priorHeadSha);
  const current = requireSha("currentHeadSha", input.currentHeadSha);
  if (prior === current) {
    throw new Error("closure_invalidated requires distinct head SHAs");
  }
  if (!input.reason) throw new Error("reason required");
  return {
    prior_head_sha: prior,
    current_head_sha: current,
    reason: input.reason,
  };
}

/** founder_review_ready payload helper. */
export function buildFounderReviewReadyPayload(input: {
  implementationSha: string;
  validatedSha: string;
  reviewedSha: string;
  activeContractVersion: number;
  activeContractDigest: string;
  closureEvidenceRef: string;
  predicateResultId: string;
}) {
  const implementation_sha = requireSha(
    "implementationSha",
    input.implementationSha,
  );
  const validated_sha = requireSha("validatedSha", input.validatedSha);
  const reviewed_sha = requireSha("reviewedSha", input.reviewedSha);
  if (
    !(
      implementation_sha === validated_sha && validated_sha === reviewed_sha
    )
  ) {
    throw new Error("founder_review_ready requires equal SHA pins");
  }
  return {
    implementation_sha,
    validated_sha,
    reviewed_sha,
    active_contract_version: input.activeContractVersion,
    active_contract_digest: input.activeContractDigest,
    closure_evidence_ref: input.closureEvidenceRef,
    predicate_result_id: input.predicateResultId,
  };
}
