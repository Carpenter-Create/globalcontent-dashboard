import { gitShaSchema } from "./contract-schema";

export type FindingSeverity = "Critical" | "Important" | "Minor";

export type ClosureFinding = {
  id: string;
  severity: FindingSeverity;
  status: "open" | "addressed" | "deferred";
};

export type FounderDisposition = {
  findingId: string;
  disposition: "accepted_by_founder" | "deferred" | "wont_fix_founder";
};

export type ObservedCheckResult = {
  name: string;
  sha: string;
  conclusion: "success" | "failure" | "pending" | "queued" | "in_progress" | "neutral";
  checkRunId: string | null;
};

/** Repository validation floor check names used by Phase A fixtures/predicate. */
export const VALIDATION_FLOOR_CHECK_NAMES = [
  "isolation",
  "typecheck",
  "test",
  "eslint_src",
  "build",
] as const;

export type ClosureReadinessInput = {
  expectations: {
    authorizedContractVersion: number;
    authorizedContractDigest: string;
    /** Must include the repository validation floor (+ contract additions). */
    expectedRequiredCheckNames: string[];
    expectedAcceptanceCriterionIds: string[];
    implementerSessionOrRunId: string;
    reviewerSessionOrRunId: string;
    /** If true, reviewer independence fails (architecture forbids push). */
    reviewerMayPush: boolean;
  };
  observed: {
    pr: { open: boolean; headSha: string };
    implementationSha: string;
    validatedSha: string;
    reviewedSha: string;
    reviewStatus: "none" | "pending" | "approved" | "changes_requested" | "stale";
    checkResults: ObservedCheckResult[];
    acceptanceResults: { id: string; satisfied: boolean }[];
    findings: ClosureFinding[];
    founderDispositions: FounderDisposition[];
    scopeViolations: string[];
    unauthorizedProductionOrDestructiveAttempt: boolean;
  };
};

export type ClosureReadinessResult = {
  ready: boolean;
  reasons: string[];
};

function isSha(s: string): boolean {
  return gitShaSchema.safeParse(s).success;
}

/**
 * Pure closure-readiness predicate (spec §7.2).
 * Reviewer independence is derived from session identities + push attestation.
 */
export function evaluateClosureReadiness(
  input: ClosureReadinessInput,
): ClosureReadinessResult {
  const reasons: string[] = [];
  const { expectations: exp, observed: obs } = input;

  if (!Array.isArray(exp.expectedRequiredCheckNames) ||
      exp.expectedRequiredCheckNames.length === 0) {
    reasons.push("expected_required_checks_empty");
  }

  if (!obs.pr.open) reasons.push("pr_not_open");

  if (!isSha(obs.pr.headSha) || !isSha(obs.implementationSha) ||
      !isSha(obs.validatedSha) || !isSha(obs.reviewedSha)) {
    reasons.push("invalid_sha_format");
  }

  const head = obs.pr.headSha;
  if (
    !(
      head === obs.implementationSha &&
      head === obs.validatedSha &&
      head === obs.reviewedSha
    )
  ) {
    if (head !== obs.implementationSha) {
      reasons.push("head_implementation_sha_mismatch");
    }
    if (head !== obs.validatedSha) reasons.push("head_validated_sha_mismatch");
    if (head !== obs.reviewedSha) reasons.push("head_reviewed_sha_mismatch");
  }

  if (obs.reviewStatus !== "approved") reasons.push("review_not_approved");

  // Check evidence completeness
  const byName = new Map<string, ObservedCheckResult[]>();
  for (const c of obs.checkResults) {
    const list = byName.get(c.name) ?? [];
    list.push(c);
    byName.set(c.name, list);
  }

  for (const name of exp.expectedRequiredCheckNames) {
    const list = byName.get(name) ?? [];
    if (list.length === 0) {
      reasons.push(`missing_required_check:${name}`);
      continue;
    }
    if (list.length > 1) {
      const conclusions = new Set(list.map((x) => `${x.conclusion}@${x.sha}`));
      if (conclusions.size > 1) {
        reasons.push(`contradictory_check_evidence:${name}`);
        continue;
      }
    }
    const check = list[0];
    if (check.sha !== head) {
      reasons.push(`required_check_wrong_sha:${name}`);
      continue;
    }
    if (
      check.conclusion === "pending" ||
      check.conclusion === "queued" ||
      check.conclusion === "in_progress"
    ) {
      reasons.push(`required_check_pending:${name}`);
    } else if (check.conclusion !== "success") {
      reasons.push(`required_check_failed:${name}`);
    } else if (!check.checkRunId || check.checkRunId.length === 0) {
      reasons.push(`required_check_missing_run_id:${name}`);
    }
  }

  // Acceptance criteria: every expected ID must appear satisfied
  const acById = new Map(obs.acceptanceResults.map((a) => [a.id, a]));
  for (const id of exp.expectedAcceptanceCriterionIds) {
    const row = acById.get(id);
    if (!row) {
      reasons.push(`missing_acceptance_criterion:${id}`);
    } else if (!row.satisfied) {
      reasons.push(`acceptance_incomplete:${id}`);
    }
  }

  const dispositions = new Map(
    obs.founderDispositions.map((d) => [d.findingId, d.disposition]),
  );

  for (const f of obs.findings) {
    if (f.severity === "Critical") {
      if (f.status !== "addressed") {
        reasons.push(`unresolved_critical:${f.id}`);
      }
      if (dispositions.get(f.id) === "accepted_by_founder") {
        reasons.push(`critical_non_waivable:${f.id}`);
      }
    } else if (f.severity === "Important") {
      if (f.status === "open" || f.status === "deferred") {
        const d = dispositions.get(f.id);
        if (d !== "accepted_by_founder" && d !== "wont_fix_founder") {
          reasons.push(`unresolved_important:${f.id}`);
        }
      }
    }
  }

  if (obs.scopeViolations.length > 0) {
    reasons.push("scope_violations_present");
  }
  if (obs.unauthorizedProductionOrDestructiveAttempt) {
    reasons.push("unauthorized_production_or_destructive_attempt");
  }

  // Derived reviewer independence
  if (
    !exp.implementerSessionOrRunId ||
    !exp.reviewerSessionOrRunId ||
    exp.implementerSessionOrRunId === exp.reviewerSessionOrRunId
  ) {
    reasons.push("reviewer_independence_same_session");
  }
  if (exp.reviewerMayPush) {
    reasons.push("reviewer_may_push");
  }

  return { ready: reasons.length === 0, reasons };
}
