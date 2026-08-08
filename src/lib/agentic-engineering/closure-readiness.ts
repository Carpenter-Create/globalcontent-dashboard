export type FindingSeverity = "Critical" | "Important" | "Minor";

export type ClosureFinding = {
  id: string;
  severity: FindingSeverity;
  status: "open" | "addressed" | "deferred" | "accepted_by_founder";
};

export type CheckResult = {
  name: string;
  sha: string;
  conclusion: "success" | "failure" | "pending" | "queued" | "in_progress" | "neutral";
  checkRunId?: string;
};

export type ClosureReadinessInput = {
  authorizedContractVersion: number;
  authorizedContractDigest: string;
  observedContractVersion: number;
  observedContractDigest: string;
  pr: { open: boolean; headSha: string };
  implementationSha: string | null;
  validatedSha: string | null;
  reviewedSha: string | null;
  reviewStatus: "none" | "pending" | "approved" | "changes_requested" | "stale";
  requiredChecks: CheckResult[];
  findings: ClosureFinding[];
  scopeViolations: string[];
  unauthorizedProductionOrDestructiveAttempt: boolean;
  reviewerIndependence: {
    present: boolean;
    distinctSessionFromImplementer: boolean;
    nonPushingCredential: boolean;
  };
  acceptanceCriteria: { id: string; satisfied: boolean }[];
};

export type ClosureReadinessResult = {
  ready: boolean;
  reasons: string[];
};

/**
 * Pure closure-readiness predicate (spec §7.2). No network I/O.
 */
export function evaluateClosureReadiness(
  input: ClosureReadinessInput,
): ClosureReadinessResult {
  const reasons: string[] = [];

  if (!input.pr.open) reasons.push("pr_not_open");

  if (
    input.observedContractVersion !== input.authorizedContractVersion ||
    input.observedContractDigest !== input.authorizedContractDigest
  ) {
    reasons.push("contract_identity_mismatch");
  }

  const head = input.pr.headSha;
  const impl = input.implementationSha;
  const validated = input.validatedSha;
  const reviewed = input.reviewedSha;

  if (!impl || !validated || !reviewed) {
    reasons.push("missing_sha_pins");
  } else if (!(head === impl && head === validated && head === reviewed)) {
    if (head !== impl) reasons.push("head_implementation_sha_mismatch");
    if (head !== validated) reasons.push("head_validated_sha_mismatch");
    if (head !== reviewed) reasons.push("head_reviewed_sha_mismatch");
  }

  if (input.reviewStatus !== "approved") {
    reasons.push("review_not_approved");
  }

  for (const check of input.requiredChecks) {
    if (check.sha !== head) {
      reasons.push(`required_check_wrong_sha:${check.name}`);
      continue;
    }
    if (
      check.conclusion === "pending" ||
      check.conclusion === "queued" ||
      check.conclusion === "in_progress"
    ) {
      reasons.push(`required_check_pending:${check.name}`);
    } else if (check.conclusion !== "success") {
      reasons.push(`required_check_failed:${check.name}`);
    }
  }

  for (const f of input.findings) {
    if (f.severity === "Critical") {
      // Critical is non-waivable for closure in v1, including founder "accept".
      if (f.status !== "addressed") {
        reasons.push(
          f.status === "accepted_by_founder"
            ? `critical_non_waivable:${f.id}`
            : `unresolved_critical:${f.id}`,
        );
      }
    } else if (f.severity === "Important") {
      if (f.status === "open" || f.status === "deferred") {
        reasons.push(`unresolved_important:${f.id}`);
      }
      // accepted_by_founder / addressed OK
    }
  }

  if (input.scopeViolations.length > 0) {
    reasons.push("scope_violations_present");
  }

  if (input.unauthorizedProductionOrDestructiveAttempt) {
    reasons.push("unauthorized_production_or_destructive_attempt");
  }

  const ri = input.reviewerIndependence;
  if (
    !ri.present ||
    !ri.distinctSessionFromImplementer ||
    !ri.nonPushingCredential
  ) {
    reasons.push("reviewer_independence_missing");
  }

  for (const ac of input.acceptanceCriteria) {
    if (!ac.satisfied) reasons.push(`acceptance_incomplete:${ac.id}`);
  }

  return { ready: reasons.length === 0, reasons };
}
