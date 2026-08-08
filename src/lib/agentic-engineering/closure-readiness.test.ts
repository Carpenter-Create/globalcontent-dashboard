import { describe, expect, it } from "vitest";

import {
  CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
  evaluateClosureReadiness,
  requiredChecksWithFloor,
  VALIDATION_FLOOR_CHECK_NAMES,
  type AuthorizedContractExpectations,
  type ClosureReadinessInput,
} from "./closure-readiness";
import { computeEventDigest, withEventDigest } from "./event-digest";
import { verifyEventChain } from "./event-chain";
import type { ControlEvent } from "./event-schema";
import {
  authorizePayload,
  chainEvents,
  floorCheckResults,
  SAMPLE_DIGEST,
  SAMPLE_DIGEST_B,
  SAMPLE_SHA,
  SAMPLE_SHA_B,
} from "./test-fixtures";

/** Minimal valid chain (no dispositions). */
function baseControlChain(): ControlEvent[] {
  return chainEvents([
    { type: "contract_staged" },
    {
      type: "authorize",
      payload: authorizePayload({
        founder_actor_id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
      }),
    },
  ]);
}

/** Valid chain containing a finding_disposition (passes verifyEventChain). */
function chainWithDisposition(
  payloadOverrides: Record<string, unknown> = {},
  eventOverrides: { activeDigest?: string; activeVersion?: number } = {},
): ControlEvent[] {
  return chainEvents([
    { type: "contract_staged" },
    {
      type: "authorize",
      payload: authorizePayload({
        founder_actor_id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
      }),
    },
    {
      type: "finding_disposition",
      payload: {
        finding_id: "F2",
        disposition: "accepted_by_founder",
        founder_actor_id: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        ...payloadOverrides,
      },
      activeDigest: eventOverrides.activeDigest,
      activeVersion: eventOverrides.activeVersion,
    },
  ]);
}

function readyInput(
  overrides: {
    expectations?: Omit<
      Partial<ClosureReadinessInput["expectations"]>,
      "authorizedContract"
    > & {
      authorizedContract?: Partial<AuthorizedContractExpectations>;
    };
    observed?: Partial<ClosureReadinessInput["observed"]>;
  } = {},
): ClosureReadinessInput {
  const { authorizedContract: authOverrides, ...expRest } =
    overrides.expectations ?? {};
  return {
    expectations: {
      authorizedContract: {
        taskId: "AE-0001",
        version: 1,
        digest: SAMPLE_DIGEST,
        requiredCheckNames: requiredChecksWithFloor(),
        acceptanceCriterionIds: ["AC1"],
        ...authOverrides,
      },
      expectedFounderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
      implementerSessionOrRunId: "impl-session-1",
      reviewerSessionOrRunId: "review-session-1",
      reviewerMayPush: false,
      ...expRest,
    },
    observed: {
      activeContractVersion: 1,
      activeContractDigest: SAMPLE_DIGEST,
      pr: { open: true, headSha: SAMPLE_SHA },
      implementationSha: SAMPLE_SHA,
      validatedSha: SAMPLE_SHA,
      reviewedSha: SAMPLE_SHA,
      reviewStatus: "approved",
      checkResults: floorCheckResults(),
      acceptanceResults: [{ id: "AC1", satisfied: true }],
      findings: [],
      controlEvents: baseControlChain(),
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

  describe("observed active contract identity", () => {
    it("correct observed version/digest may proceed", () => {
      const r = evaluateClosureReadiness(readyInput());
      expect(r.ready).toBe(true);
    });

    it("observed version mismatch → not ready", () => {
      const r = evaluateClosureReadiness(
        readyInput({ observed: { activeContractVersion: 2 } }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("active_contract_version_mismatch");
    });

    it("observed digest mismatch → not ready", () => {
      const r = evaluateClosureReadiness(
        readyInput({ observed: { activeContractDigest: SAMPLE_DIGEST_B } }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("active_contract_digest_mismatch");
    });

    it("observed active contract missing → not ready", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          observed: {
            activeContractVersion: null,
            activeContractDigest: null,
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("observed_active_contract_missing");
    });

    it("expected authorized contract missing/invalid → not ready", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          expectations: {
            authorizedContract: {
              version: 0,
              digest: "not-a-digest",
            },
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("authorized_contract_version_invalid");
      expect(r.reasons).toContain("authorized_contract_digest_invalid");
    });

    it("contract identity mismatch even when SHAs/checks/review are valid → not ready", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          observed: {
            activeContractVersion: 1,
            activeContractDigest: SAMPLE_DIGEST_B,
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("active_contract_digest_mismatch");
      // Other gates still look good — only contract identity fails
      expect(r.reasons).not.toContain("review_not_approved");
      expect(r.reasons).not.toContain("head_reviewed_sha_mismatch");
    });
  });

  describe("validation floor non-omittable", () => {
    it("complete built-in floor → valid when evidence complete", () => {
      const r = evaluateClosureReadiness(readyInput());
      expect(r.ready).toBe(true);
      for (const name of VALIDATION_FLOOR_CHECK_NAMES) {
        expect(
          readyInput().expectations.authorizedContract.requiredCheckNames,
        ).toContain(name);
      }
    });

    for (const omitted of VALIDATION_FLOOR_CHECK_NAMES) {
      it(`omit ${omitted} from expectations → not ready`, () => {
        const names = VALIDATION_FLOOR_CHECK_NAMES.filter((n) => n !== omitted);
        const r = evaluateClosureReadiness(
          readyInput({
            expectations: {
              authorizedContract: { requiredCheckNames: [...names] },
            },
            observed: {
              checkResults: floorCheckResults().filter((c) => c.name !== omitted),
            },
          }),
        );
        expect(r.ready).toBe(false);
        expect(r.reasons).toContain(
          `missing_floor_check_expectation:${omitted}`,
        );
      });
    }

    it("duplicate expected required check → not ready", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          expectations: {
            authorizedContract: {
              requiredCheckNames: [
                ...VALIDATION_FLOOR_CHECK_NAMES,
                "isolation",
              ],
            },
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("duplicate_expected_check:isolation");
    });

    it("duplicate observed evidence for same check, even identical → not ready", () => {
      const base = floorCheckResults();
      const isolation = base.find((c) => c.name === "isolation")!;
      const r = evaluateClosureReadiness(
        readyInput({
          observed: { checkResults: [...base, { ...isolation }] },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain(
        "duplicate_observed_check_evidence:isolation",
      );
    });

    it("contract-added check missing observed evidence → not ready", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          expectations: {
            authorizedContract: {
              requiredCheckNames: requiredChecksWithFloor(["extra_check"]),
            },
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("missing_required_check:extra_check");
    });

    it("built-in floor + contract addition all green → may proceed", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          expectations: {
            authorizedContract: {
              requiredCheckNames: requiredChecksWithFloor(["extra_check"]),
            },
          },
          observed: {
            checkResults: [
              ...floorCheckResults(),
              {
                name: "extra_check",
                sha: SAMPLE_SHA,
                conclusion: "success",
                checkRunId: "cr-extra",
              },
            ],
          },
        }),
      );
      expect(r.ready).toBe(true);
    });

    it("supplying only isolation (omitting floor) → not ready", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          expectations: {
            authorizedContract: { requiredCheckNames: ["isolation"] },
          },
          observed: {
            checkResults: [
              {
                name: "isolation",
                sha: SAMPLE_SHA,
                conclusion: "success",
                checkRunId: "1",
              },
            ],
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("missing_floor_check_expectation:typecheck");
      expect(r.reasons).toContain("missing_floor_check_expectation:test");
      expect(r.reasons).toContain("missing_floor_check_expectation:eslint_src");
      expect(r.reasons).toContain("missing_floor_check_expectation:build");
    });
  });

  describe("acceptance criteria authority", () => {
    it("empty authorized acceptance list is legitimate when contract has none", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          expectations: {
            authorizedContract: { acceptanceCriterionIds: [] },
          },
          observed: { acceptanceResults: [] },
        }),
      );
      expect(r.ready).toBe(true);
    });

    it("duplicate expected acceptance IDs → not ready", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          expectations: {
            authorizedContract: {
              acceptanceCriterionIds: ["AC1", "AC1"],
            },
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("duplicate_expected_acceptance:AC1");
    });

    it("duplicate observed acceptance evidence → not ready", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          observed: {
            acceptanceResults: [
              { id: "AC1", satisfied: true },
              { id: "AC1", satisfied: true },
            ],
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("duplicate_observed_acceptance:AC1");
    });

    it("missing acceptance criterion → not ready", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          expectations: {
            authorizedContract: {
              acceptanceCriterionIds: ["AC1", "AC2"],
            },
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("missing_acceptance_criterion:AC2");
    });

    it("unexpected acceptance evidence cannot substitute for missing IDs", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          expectations: {
            authorizedContract: { acceptanceCriterionIds: ["AC1"] },
          },
          observed: {
            acceptanceResults: [{ id: "OTHER", satisfied: true }],
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("missing_acceptance_criterion:AC1");
    });
  });

  describe("control-chain provenance for founder dispositions", () => {
    it("Important + no event chain disposition → not ready", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          observed: {
            findings: [{ id: "F2", severity: "Important", status: "open" }],
            controlEvents: baseControlChain(),
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("unresolved_important:F2");
    });

    it("Important + fabricated standalone disposition object is not accepted", () => {
      type ObservedKeys = keyof ClosureReadinessInput["observed"];
      type HasStandalone = "verifiedFindingDispositions" extends ObservedKeys
        ? true
        : false;
      const standaloneStillAnInput: HasStandalone = false;
      expect(standaloneStillAnInput).toBe(false);

      const fabricated = {
        eventType: "finding_disposition",
        taskId: "AE-0001",
        findingId: "F2",
        disposition: "accepted_by_founder",
        founderActorId: CONFIGURED_FOUNDER_GITHUB_ACTOR_ID,
        eventDigest: "sha256:" + "e".repeat(64),
        sequence: 9,
        activeContractVersion: 1,
        activeContractDigest: SAMPLE_DIGEST,
      };
      const base = readyInput({
        observed: {
          findings: [{ id: "F2", severity: "Important", status: "open" }],
          controlEvents: baseControlChain(),
        },
      });
      // Smuggle a fabricated parallel authority field — predicate must ignore it.
      const smuggled = {
        ...base,
        observed: {
          ...base.observed,
          verifiedFindingDispositions: [fabricated],
        },
      };
      const r = evaluateClosureReadiness(smuggled as ClosureReadinessInput);
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("unresolved_important:F2");
    });

    it("Important + well-formed random digest not present in verified chain → not ready", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          observed: {
            findings: [{ id: "F2", severity: "Important", status: "open" }],
            controlEvents: baseControlChain(),
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("unresolved_important:F2");
      expect(r.reasons).not.toContain("control_event_chain_invalid");
    });

    it("Important + correct digest format but wrong positive sequence → not ready", () => {
      const events = chainWithDisposition();
      expect(verifyEventChain(events).ok).toBe(true);
      const broken = { ...events[2], sequence: 9 };
      delete (broken as { event_digest?: string }).event_digest;
      const chain = [
        events[0],
        events[1],
        withEventDigest(broken as Parameters<typeof withEventDigest>[0]),
      ];
      const r = evaluateClosureReadiness(
        readyInput({
          observed: {
            findings: [{ id: "F2", severity: "Important", status: "open" }],
            controlEvents: chain,
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("control_event_chain_invalid");
      expect(r.reasons).toContain("control_event_chain:sequence_gap");
    });

    it("Important + event in chain but wrong founder actor → not ready", () => {
      const events = chainWithDisposition({ founder_actor_id: 99999 });
      expect(verifyEventChain(events).ok).toBe(true);
      const r = evaluateClosureReadiness(
        readyInput({
          observed: {
            findings: [{ id: "F2", severity: "Important", status: "open" }],
            controlEvents: events,
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("unresolved_important:F2");
    });

    it("Important + event in chain but wrong finding ID → not ready", () => {
      const events = chainWithDisposition({ finding_id: "OTHER" });
      expect(verifyEventChain(events).ok).toBe(true);
      const r = evaluateClosureReadiness(
        readyInput({
          observed: {
            findings: [{ id: "F2", severity: "Important", status: "open" }],
            controlEvents: events,
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("unresolved_important:F2");
    });

    it("Important + event in chain but wrong contract digest → not ready", () => {
      const events = chainWithDisposition({}, { activeDigest: SAMPLE_DIGEST_B });
      expect(verifyEventChain(events).ok).toBe(false);
      const r = evaluateClosureReadiness(
        readyInput({
          observed: {
            findings: [{ id: "F2", severity: "Important", status: "open" }],
            controlEvents: events,
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("control_event_chain_invalid");
    });

    it("Important + event in chain but wrong contract version → not ready", () => {
      const events = chainWithDisposition({}, { activeVersion: 2 });
      expect(verifyEventChain(events).ok).toBe(false);
      const r = evaluateClosureReadiness(
        readyInput({
          observed: {
            findings: [{ id: "F2", severity: "Important", status: "open" }],
            controlEvents: events,
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("control_event_chain_invalid");
    });

    it("Important + chain with broken prev digest → not ready", () => {
      const events = chainWithDisposition();
      const rest = {
        ...events[2],
        prev_event_digest: events[0].event_digest,
      };
      delete (rest as { event_digest?: string }).event_digest;
      const chain = [
        events[0],
        events[1],
        { ...rest, event_digest: computeEventDigest(rest) },
      ];
      const r = evaluateClosureReadiness(
        readyInput({
          observed: {
            findings: [{ id: "F2", severity: "Important", status: "open" }],
            controlEvents: chain,
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("control_event_chain_invalid");
      expect(r.reasons).toContain("control_event_chain:prev_digest_mismatch");
    });

    it("Important + chain with sequence gap → not ready", () => {
      const events = chainWithDisposition();
      const r = evaluateClosureReadiness(
        readyInput({
          observed: {
            findings: [{ id: "F2", severity: "Important", status: "open" }],
            controlEvents: [events[0], events[2]],
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("control_event_chain_invalid");
    });

    it("Important + valid verified chain containing matching finding_disposition → may proceed", () => {
      const events = chainWithDisposition();
      expect(verifyEventChain(events).ok).toBe(true);
      const r = evaluateClosureReadiness(
        readyInput({
          observed: {
            findings: [{ id: "F2", severity: "Important", status: "open" }],
            controlEvents: events,
          },
        }),
      );
      expect(r.ready).toBe(true);
      expect(r.reasons).toEqual([]);
    });

    it("Critical + valid verified founder disposition event → still not ready", () => {
      const events = chainWithDisposition({ finding_id: "F1" });
      expect(verifyEventChain(events).ok).toBe(true);
      const r = evaluateClosureReadiness(
        readyInput({
          observed: {
            findings: [{ id: "F1", severity: "Critical", status: "addressed" }],
            controlEvents: events,
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("critical_non_waivable:F1");
    });

    it("expected founder actor ID missing/invalid → fail closed", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          expectations: { expectedFounderActorId: 0 },
          observed: {
            findings: [{ id: "F2", severity: "Important", status: "open" }],
            controlEvents: chainWithDisposition(),
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("expected_founder_actor_id_invalid");
    });

    it("expected founder actor ID not the configured repo identity → fail closed", () => {
      const r = evaluateClosureReadiness(
        readyInput({
          expectations: { expectedFounderActorId: 99999 },
          observed: {
            findings: [{ id: "F2", severity: "Important", status: "open" }],
            controlEvents: chainWithDisposition({ founder_actor_id: 99999 }),
          },
        }),
      );
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain("expected_founder_actor_id_not_configured");
    });
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
      c.name === "isolation" ? { ...c, conclusion: "pending" as const } : c,
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
