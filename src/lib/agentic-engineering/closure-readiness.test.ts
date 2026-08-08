import { describe, expect, it } from "vitest";

import { evaluateClosureReadiness } from "./closure-readiness";
import { SAMPLE_DIGEST, SAMPLE_SHA, SAMPLE_SHA_B } from "./test-fixtures";

function readyInput(
  overrides: Partial<Parameters<typeof evaluateClosureReadiness>[0]> = {},
) {
  return {
    authorizedContractVersion: 1,
    authorizedContractDigest: SAMPLE_DIGEST,
    observedContractVersion: 1,
    observedContractDigest: SAMPLE_DIGEST,
    pr: { open: true, headSha: SAMPLE_SHA },
    implementationSha: SAMPLE_SHA,
    validatedSha: SAMPLE_SHA,
    reviewedSha: SAMPLE_SHA,
    reviewStatus: "approved" as const,
    requiredChecks: [
      {
        name: "isolation",
        sha: SAMPLE_SHA,
        conclusion: "success" as const,
        checkRunId: "1",
      },
    ],
    findings: [],
    scopeViolations: [],
    unauthorizedProductionOrDestructiveAttempt: false,
    reviewerIndependence: {
      present: true,
      distinctSessionFromImplementer: true,
      nonPushingCredential: true,
    },
    acceptanceCriteria: [{ id: "AC1", satisfied: true }],
    ...overrides,
  };
}

describe("evaluateClosureReadiness", () => {
  it("returns ready for a fully valid snapshot", () => {
    const r = evaluateClosureReadiness(readyInput());
    expect(r.ready).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("fails on head/review SHA mismatch", () => {
    const r = evaluateClosureReadiness(
      readyInput({ reviewedSha: SAMPLE_SHA_B }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("head_reviewed_sha_mismatch");
  });

  it("fails on head/validated SHA mismatch", () => {
    const r = evaluateClosureReadiness(
      readyInput({ validatedSha: SAMPLE_SHA_B }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("head_validated_sha_mismatch");
  });

  it("fails when a required check is pending", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        requiredChecks: [
          { name: "isolation", sha: SAMPLE_SHA, conclusion: "pending" },
        ],
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons.some((x) => x.startsWith("required_check_pending"))).toBe(
      true,
    );
  });

  it("fails when a required check failed", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        requiredChecks: [
          { name: "isolation", sha: SAMPLE_SHA, conclusion: "failure" },
        ],
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons.some((x) => x.startsWith("required_check_failed"))).toBe(
      true,
    );
  });

  it("fails on unresolved Critical", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        findings: [{ id: "F1", severity: "Critical", status: "open" }],
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("unresolved_critical:F1");
  });

  it("fails on unresolved Important without founder disposition", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        findings: [{ id: "F2", severity: "Important", status: "open" }],
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("unresolved_important:F2");
  });

  it("allows Important accepted_by_founder", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        findings: [
          { id: "F2", severity: "Important", status: "accepted_by_founder" },
        ],
      }),
    );
    expect(r.ready).toBe(true);
  });

  it("never allows Critical accepted_by_founder", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        findings: [
          { id: "F1", severity: "Critical", status: "accepted_by_founder" },
        ],
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("critical_non_waivable:F1");
  });

  it("fails on scope violation", () => {
    const r = evaluateClosureReadiness(
      readyInput({ scopeViolations: ["touched .github/workflows"] }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("scope_violations_present");
  });

  it("fails when reviewer independence missing", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        reviewerIndependence: {
          present: false,
          distinctSessionFromImplementer: false,
          nonPushingCredential: false,
        },
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("reviewer_independence_missing");
  });

  it("fails on unauthorized production/destructive attempt", () => {
    const r = evaluateClosureReadiness(
      readyInput({ unauthorizedProductionOrDestructiveAttempt: true }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain(
      "unauthorized_production_or_destructive_attempt",
    );
  });

  it("fails when acceptance criteria incomplete", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        acceptanceCriteria: [{ id: "AC1", satisfied: false }],
      }),
    );
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain("acceptance_incomplete:AC1");
  });

  it("mutation: if SHA equality were dropped, this mismatch would wrongly pass", () => {
    const r = evaluateClosureReadiness(
      readyInput({
        implementationSha: SAMPLE_SHA,
        validatedSha: SAMPLE_SHA,
        reviewedSha: SAMPLE_SHA_B,
        pr: { open: true, headSha: SAMPLE_SHA },
      }),
    );
    expect(r.ready).toBe(false);
  });
});
