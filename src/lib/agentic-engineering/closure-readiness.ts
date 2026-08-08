import { gitShaSchema, sha256DigestSchema } from "./contract-schema";
import { verifyEventChain } from "./event-chain";
import type { ControlEvent } from "./event-schema";

export type FindingSeverity = "Critical" | "Important" | "Minor";

export type ClosureFinding = {
  id: string;
  severity: FindingSeverity;
  status: "open" | "addressed" | "deferred";
};

/**
 * Authoritative configured founder GitHub actor ID for this repository.
 * Callers pass this via expectations; the predicate compares against it.
 */
export const CONFIGURED_FOUNDER_GITHUB_ACTOR_ID = 40549435;

export type FounderDispositionValue =
  | "accepted_by_founder"
  | "deferred"
  | "wont_fix_founder";

export type ObservedCheckResult = {
  name: string;
  sha: string;
  conclusion: "success" | "failure" | "pending" | "queued" | "in_progress" | "neutral";
  checkRunId: string | null;
};

/** Repository validation floor — non-overridable in Phase A closure. */
export const VALIDATION_FLOOR_CHECK_NAMES = [
  "isolation",
  "typecheck",
  "test",
  "eslint_src",
  "build",
] as const;

export type ValidationFloorCheckName =
  (typeof VALIDATION_FLOOR_CHECK_NAMES)[number];

/**
 * Contract-derived expectations. Acceptance IDs may be empty only when the
 * authorized contract itself has zero acceptance criteria — the field must be
 * present (not omitted) so callers cannot silently drop the authorized list.
 */
export type AuthorizedContractExpectations = {
  taskId: string;
  version: number;
  digest: string;
  /**
   * Floor members (required) plus optional contract additions.
   * Every VALIDATION_FLOOR_CHECK_NAMES member must appear exactly once.
   */
  requiredCheckNames: string[];
  /** Exact acceptance criterion IDs from the authorized contract. */
  acceptanceCriterionIds: string[];
};

export type ClosureReadinessInput = {
  expectations: {
    authorizedContract: AuthorizedContractExpectations;
    /** Must be the configured founder GitHub actor ID. */
    expectedFounderActorId: number;
    implementerSessionOrRunId: string;
    reviewerSessionOrRunId: string;
    /** If true, reviewer independence fails (architecture forbids push). */
    reviewerMayPush: boolean;
  };
  observed: {
    /** Folded control-plane active contract — must not be inferred from expectations. */
    activeContractVersion: number | null;
    activeContractDigest: string | null;
    pr: { open: boolean; headSha: string };
    implementationSha: string;
    validatedSha: string;
    reviewedSha: string;
    reviewStatus: "none" | "pending" | "approved" | "changes_requested" | "stale";
    checkResults: ObservedCheckResult[];
    acceptanceResults: { id: string; satisfied: boolean }[];
    findings: ClosureFinding[];
    /**
     * Ordered control-event chain. Closure readiness verifies this chain
     * internally via verifyEventChain before deriving any founder dispositions.
     * Standalone disposition objects are not accepted.
     */
    controlEvents: unknown[];
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

function isDigest(s: string): boolean {
  return sha256DigestSchema.safeParse(s).success;
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function isWaivingDisposition(disposition: string): boolean {
  return (
    disposition === "accepted_by_founder" || disposition === "wont_fix_founder"
  );
}

type DerivedDisposition = {
  taskId: string;
  findingId: string;
  disposition: string;
  founderActorId: number;
  activeContractVersion: number;
  activeContractDigest: string;
};

function deriveFindingDispositions(
  events: ControlEvent[],
): DerivedDisposition[] {
  const out: DerivedDisposition[] = [];
  for (const ev of events) {
    if (ev.event_type !== "finding_disposition") continue;
    out.push({
      taskId: ev.task_id,
      findingId: ev.payload.finding_id,
      disposition: ev.payload.disposition,
      founderActorId: ev.payload.founder_actor_id,
      activeContractVersion: ev.active_contract_version,
      activeContractDigest: ev.active_contract_digest,
    });
  }
  return out;
}

function matchesVerifiedWaiver(
  findingId: string,
  expectedTaskId: string,
  d: DerivedDisposition,
  expectedFounderActorId: number,
  contractVersion: number,
  contractDigest: string,
): boolean {
  if (d.taskId !== expectedTaskId) return false;
  if (d.findingId !== findingId) return false;
  if (d.founderActorId !== expectedFounderActorId) return false;
  if (d.activeContractVersion !== contractVersion) return false;
  if (d.activeContractDigest !== contractDigest) return false;
  if (!isWaivingDisposition(d.disposition)) return false;
  return true;
}

/**
 * Pure closure-readiness predicate (spec §7.2).
 * Reviewer independence is derived from session identities + push attestation.
 * Important waivers require finding_disposition events inside a successfully
 * verified control-event chain (verifyEventChain runs inside this predicate).
 */
export function evaluateClosureReadiness(
  input: ClosureReadinessInput,
): ClosureReadinessResult {
  const reasons: string[] = [];
  const { expectations: exp, observed: obs } = input;
  const auth = exp.authorizedContract;

  // --- Founder identity expectation ---
  let founderIdOk = false;
  if (
    typeof exp.expectedFounderActorId !== "number" ||
    !Number.isInteger(exp.expectedFounderActorId) ||
    exp.expectedFounderActorId < 1 ||
    !Number.isSafeInteger(exp.expectedFounderActorId)
  ) {
    reasons.push("expected_founder_actor_id_invalid");
  } else if (exp.expectedFounderActorId !== CONFIGURED_FOUNDER_GITHUB_ACTOR_ID) {
    reasons.push("expected_founder_actor_id_not_configured");
  } else {
    founderIdOk = true;
  }

  // --- Authorized contract expectations ---
  let authVersionOk = false;
  let authDigestOk = false;
  let authTaskIdOk = false;
  if (
    !auth ||
    typeof auth.taskId !== "string" ||
    !/^AE-[0-9]{4,}$/.test(auth.taskId)
  ) {
    reasons.push("authorized_contract_task_id_invalid");
  } else {
    authTaskIdOk = true;
  }
  if (
    !auth ||
    typeof auth.version !== "number" ||
    !Number.isInteger(auth.version) ||
    auth.version < 1
  ) {
    reasons.push("authorized_contract_version_invalid");
  } else {
    authVersionOk = true;
  }
  if (!auth || typeof auth.digest !== "string" || !isDigest(auth.digest)) {
    reasons.push("authorized_contract_digest_invalid");
  } else {
    authDigestOk = true;
  }

  // --- Observed active contract identity (never inferred) ---
  let contractIdentityOk = false;
  if (
    obs.activeContractVersion == null ||
    obs.activeContractDigest == null ||
    obs.activeContractDigest === ""
  ) {
    reasons.push("observed_active_contract_missing");
  } else if (authVersionOk && authDigestOk) {
    if (obs.activeContractVersion !== auth.version) {
      reasons.push("active_contract_version_mismatch");
    } else if (obs.activeContractDigest !== auth.digest) {
      reasons.push("active_contract_digest_mismatch");
    } else {
      contractIdentityOk = true;
    }
  }

  // --- Control event chain (canonical authority for dispositions) ---
  let verifiedDispositions: DerivedDisposition[] = [];
  let chainOk = false;
  if (!Array.isArray(obs.controlEvents)) {
    reasons.push("control_event_chain_invalid");
  } else {
    const chain = verifyEventChain(obs.controlEvents);
    if (!chain.ok) {
      reasons.push("control_event_chain_invalid");
      for (const issue of chain.issues) {
        reasons.push(`control_event_chain:${issue.code}`);
      }
    } else {
      chainOk = true;
      verifiedDispositions = deriveFindingDispositions(chain.events);
      if (
        authTaskIdOk &&
        chain.events.some((ev) => ev.task_id !== auth.taskId)
      ) {
        reasons.push("control_event_task_id_mismatch");
        chainOk = false;
      }
    }
  }

  // --- Required checks: floor non-omittable + exact-once expected ---
  const expectedChecks = auth?.requiredCheckNames;
  if (!Array.isArray(expectedChecks)) {
    reasons.push("expected_required_checks_missing");
  } else {
    if (expectedChecks.length === 0) {
      reasons.push("expected_required_checks_empty");
    }
    const expectedCounts = countBy(expectedChecks, (n) => n);
    for (const [name, count] of expectedCounts) {
      if (count > 1) {
        reasons.push(`duplicate_expected_check:${name}`);
      }
    }
    for (const floor of VALIDATION_FLOOR_CHECK_NAMES) {
      if ((expectedCounts.get(floor) ?? 0) === 0) {
        reasons.push(`missing_floor_check_expectation:${floor}`);
      }
    }

    const byName = new Map<string, ObservedCheckResult[]>();
    for (const c of obs.checkResults) {
      const list = byName.get(c.name) ?? [];
      list.push(c);
      byName.set(c.name, list);
    }

    const uniqueExpected = [...expectedCounts.keys()];
    for (const name of uniqueExpected) {
      const list = byName.get(name) ?? [];
      if (list.length === 0) {
        reasons.push(`missing_required_check:${name}`);
        continue;
      }
      if (list.length > 1) {
        reasons.push(`duplicate_observed_check_evidence:${name}`);
        continue;
      }
      const check = list[0];
      if (check.sha !== obs.pr.headSha) {
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
  }

  if (!obs.pr.open) reasons.push("pr_not_open");

  if (
    !isSha(obs.pr.headSha) ||
    !isSha(obs.implementationSha) ||
    !isSha(obs.validatedSha) ||
    !isSha(obs.reviewedSha)
  ) {
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

  // --- Acceptance criteria (contract-derived; empty list only if contract has none) ---
  const expectedAc = auth?.acceptanceCriterionIds;
  if (!Array.isArray(expectedAc)) {
    reasons.push("acceptance_expectations_missing");
  } else {
    const expectedAcCounts = countBy(expectedAc, (id) => id);
    for (const [id, count] of expectedAcCounts) {
      if (count > 1) reasons.push(`duplicate_expected_acceptance:${id}`);
    }
    const observedAcCounts = countBy(obs.acceptanceResults, (a) => a.id);
    for (const [id, count] of observedAcCounts) {
      if (count > 1) reasons.push(`duplicate_observed_acceptance:${id}`);
    }
    for (const id of expectedAcCounts.keys()) {
      const matches = obs.acceptanceResults.filter((a) => a.id === id);
      if (matches.length === 0) {
        reasons.push(`missing_acceptance_criterion:${id}`);
      } else if (matches.length === 1 && !matches[0].satisfied) {
        reasons.push(`acceptance_incomplete:${id}`);
      }
    }
  }

  // --- Findings / dispositions derived only from verified chain ---
  if (chainOk) {
    const dispCounts = countBy(verifiedDispositions, (d) => d.findingId);
    for (const [id, count] of dispCounts) {
      if (count > 1) reasons.push(`duplicate_verified_disposition:${id}`);
    }
  }

  for (const f of obs.findings) {
    if (f.severity === "Critical") {
      if (f.status !== "addressed") {
        reasons.push(`unresolved_critical:${f.id}`);
      }
      if (
        chainOk &&
        verifiedDispositions.some((d) => d.findingId === f.id)
      ) {
        reasons.push(`critical_non_waivable:${f.id}`);
      }
    } else if (f.severity === "Important") {
      if (f.status === "open" || f.status === "deferred") {
        if (
          !chainOk ||
          !founderIdOk ||
          !contractIdentityOk ||
          !authVersionOk ||
          !authDigestOk ||
          !authTaskIdOk
        ) {
          reasons.push(`unresolved_important:${f.id}`);
          continue;
        }
        const match = verifiedDispositions.find((d) =>
          matchesVerifiedWaiver(
            f.id,
            auth.taskId,
            d,
            exp.expectedFounderActorId,
            auth.version,
            auth.digest,
          ),
        );
        if (!match) {
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

/** Helper for fixtures/callers: floor names plus optional contract additions. */
export function requiredChecksWithFloor(additions: string[] = []): string[] {
  return [...VALIDATION_FLOOR_CHECK_NAMES, ...additions];
}
