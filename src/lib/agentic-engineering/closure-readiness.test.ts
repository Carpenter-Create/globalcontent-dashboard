import { describe, expect, it } from "vitest";

import {
  evaluateClosureReadiness,
  VALIDATION_FLOOR_CHECK_NAMES,
  type ClosureReadinessInput,
} from "./closure-readiness";
import {
  floorCheckResults,
  SAMPLE_DIGEST,
  SAMPLE_SHA,
  SAMPLE_SHA_B,
} from "./test-fixtures";

function readyInput(
  overrides: {
    expectations?: Partial<ClosureReadinessInput["expectations"]>;
    observed?: Partial<ClosureReadinessInput["observed"]>;
  } = {},
): ClosureReadinessInput {
  return {
    expectations: {
      authorizedContractVersion: 1,
      authorizedContractDigest: SAMPLE_DIGEST,
      expectedRequiredCheckNames: [...VALIDATION_FLOOR_CHECK_NAMES],
      expectedAcceptanceCriterionIds: ["AC1"],
      implementerSessionOrRunId: "impl-session-1",
      reviewerSessionOrRunId: "review-session-1",
      reviewerMayPush: false,
      ...overrides.expectations,
    },
    observed: {
      pr: { open: true, headSha: SAMPLE_SHA },
      implementationSha: SAMPLE_SHA,
      validatedSha: SAMPLE_SHA,
      reviewedSha: SAMPLE_SHA,
      reviewStatus: "approved",
      checkResults: floorCheckResults(),
      acceptanceResults: [{ id: "AC1", satisfied: true }],
      findings: [],
      founderDispositions: [],
      scopeViolations: [],
      unauthorizedProductionOrDestructiveAttempt: false,
      ...overrides.observed,
    },
  };
}

describe("evaluateClosureReadiness", () => {
  it("returns ready for fully valid complete evidence", () => {
    const r = evaluateClosureReadiness(readyInput());
    expect(r.ready).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("empty required evidence → not ready", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        expectations: { expectedRequiredCheckNames: [] },
        observed: { checkResults: [] },
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("expected_required_checks_empty");
  });

  it("missing one expected floor check → not ready", () => {
    const checks = floorCheckResults().filter((c) => c.name !== "build");
    const r = evaluateClosureReadiness(
      readyInput({ observed: { checkResults: checks } }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("missing_required_check:build");
  });

  it("duplicate/contradictory check evidence → not ready", () => {
    const checks = [
      ...floorCheckResults(),
      {
        name: "isolation",
        sha: SAMPLE_SHA,
        conclusion: "failure" as const,
        checkRunId: "cr-x",
      },
    ];
    const r = evaluateClosureReadiness(
      readyInput({ observed: { checkResults: checks } }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("contradictory_check_evidence:isolation");
  });

  it("check success but wrong SHA → not ready", () => {
    const checks = floorCheckResults().map((c) =>
      c.name === "isolation" ? { ...c, sha: SAMPLE_SHA_B } : c,
    );
    const r = evaluateClosureReadiness(
      readyInput({ observed: { checkResults: checks } }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("required_check_wrong_sha:isolation");
  });

  it("check success with missing check-run identity → not ready", () => {
    const checks = floorCheckResults().map((c) =>
      c.name === "isolation" ? { ...c, checkRunId: null } : c,
    );
    const r = evaluateClosureReadiness(
      readyInput({ observed: { checkResults: checks } }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("required_check_missing_run_id:isolation");
  });

  it("missing acceptance criterion → not ready", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        expectations: { expectedAcceptanceCriterionIds: ["AC1", "AC2"] },
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("missing_acceptance_criterion:AC2");
  });

  it("unexpected acceptance evidence cannot substitute for missing IDs", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        expectations: { expectedAcceptanceCriterionIds: ["AC1"] },
        observed: {
          acceptanceResults: [{ id: "OTHER", satisfied: true }],
        },
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("missing_acceptance_criterion:AC1");
  });

  it("same implementer/reviewer session → not ready", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        expectations: {
          implementerSessionOrRunId: "same",
          reviewerSessionOrRunId: "same",
        },
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("reviewer_independence_same_session");
  });

  it("reviewer can push → not ready", () => {
    const r = evaluateClosureReadiness(
      readyInput({ expectations: { reviewerMayPush: true } }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("reviewer_may_push");
  });

  it("fails on head/review SHA mismatch", () => {
    const r = evaluateClosureReadiness(
      readyInput({ observed: { reviewedSha: SAMPLE_SHA_B } }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("head_reviewed_sha_mismatch");
  });

  it("fails when a required check is pending", () => {
    const checks = floorCheckResults().map((c) =>
      c.name === "isolation"
        ? { ...c, conclusion: "pending" as const }
        : c,
    );
    const r = evaluateClosureReadiness(
      readyInput({ observed: { checkResults: checks } }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("required_check_pending:isolation");
  });

  it("fails on unresolved Critical", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        observed: {
          findings: [{ id: "F1", severity: "Critical", status: "open" }],
        },
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("unresolved_critical:F1");
  });

  it("fails on unresolved Important without founder disposition", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        observed: {
          findings: [{ id: "F2", severity: "Important", status: "open" }],
        },
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("unresolved_important:F2");
  });

  it("allows Important with durable founder disposition", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        observed: {
          findings: [{ id: "F2", severity: "Important", status: "open" }],
          founderDispositions: [
            { findingId: "F2", disposition: "accepted_by_founder" },
          ],
        },
      }),
    );
    expect(r.ready).toBe(true);
  });

  it("never allows Critical waived by founder disposition", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        observed: {
          findings: [{ id: "F1", severity: "Critical", status: "addressed" }],
          founderDispositions: [
            { findingId: "F1", disposition: "accepted_by_founder" },
          ],
        },
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("critical_non_waivable:F1");
  });

  it("fails on scope violation", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        observed: { scopeViolations: ["touched .github/workflows"] },
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("scope_violations_present");
  });

  it("fails on unauthorized production/destructive attempt", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        observed: { unauthorizedProductionOrDestructiveAttempt: true },
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain(
      "unauthorized_production_or_destructive_attempt",
    );
  });

  it("fails when acceptance criteria incomplete", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        observed: {
          acceptanceResults: [{ id: "AC1", satisfied: false }],
        },
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("acceptance_incomplete:AC1");
  });
});
