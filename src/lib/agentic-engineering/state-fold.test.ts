import { describe, expect, it } from "vitest";

import { foldTaskState } from "./state-fold";
import {
  authorizePayload,
  chainEvents,
  SAMPLE_DIGEST,
  SAMPLE_SHA,
  SAMPLE_SHA_B,
} from "./test-fixtures";

describe("foldTaskState", () => {
  it("folds happy path: approved review stays REVIEWING until founder_review_ready", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize", payload: authorizePayload() },
      { type: "implementation_started" },
      { type: "implementation_declared" },
      { type: "validation_completed" },
      { type: "review_started" },
      { type: "review_completed" },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.state).toBe("REVIEWING");
      expect(r.state.reviewStatus).toBe("approved");
      expect(r.state.implementationSha).toBe(SAMPLE_SHA);
      expect(r.state.reviewedSha).toBe(SAMPLE_SHA);
    }
  });

  it("only founder_review_ready enters FOUNDER_REVIEW", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
      { type: "implementation_started" },
      { type: "implementation_declared" },
      { type: "validation_completed" },
      { type: "review_started" },
      { type: "review_completed" },
      { type: "founder_review_ready" },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.state).toBe("FOUNDER_REVIEW");
  });

  it("approved review alone cannot enter FOUNDER_REVIEW", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
      { type: "implementation_started" },
      { type: "implementation_declared" },
      { type: "validation_completed" },
      { type: "review_completed" },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.state).not.toBe("FOUNDER_REVIEW");
  });

  it("empty validation_completed cannot pass schema/fold", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
      { type: "implementation_started" },
      { type: "implementation_declared" },
    ]);
    const bad = {
      ...events[events.length - 1],
      sequence: 5,
      event_type: "validation_completed",
      payload: {},
      prev_event_digest: events[events.length - 1].event_digest,
      event_digest: SAMPLE_DIGEST,
    };
    const r = foldTaskState([...events, bad]);
    expect(r.ok).toBe(false);
  });

  it("empty review_completed cannot approve", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
      { type: "implementation_started" },
      { type: "implementation_declared" },
      { type: "validation_completed" },
    ]);
    const bad = {
      ...events[events.length - 1],
      sequence: 6,
      event_type: "review_completed",
      payload: {},
      prev_event_digest: events[events.length - 1].event_digest,
      event_digest: SAMPLE_DIGEST,
    };
    const r = foldTaskState([...events, bad]);
    expect(r.ok).toBe(false);
  });

  it("missing validation outcome cannot default to success", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
      { type: "implementation_started" },
      { type: "implementation_declared" },
    ]);
    const bad = {
      ...events[events.length - 1],
      sequence: 5,
      event_type: "validation_completed",
      payload: {
        validated_sha: SAMPLE_SHA,
        evidence_refs: [{ kind: "check_run", id: "1" }],
      },
      prev_event_digest: events[events.length - 1].event_digest,
      event_digest: SAMPLE_DIGEST,
    };
    expect(foldTaskState([...events, bad]).ok).toBe(false);
  });

  it("missing review status cannot default to approved", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
      { type: "implementation_started" },
      { type: "implementation_declared" },
      { type: "validation_completed" },
    ]);
    const bad = {
      ...events[events.length - 1],
      sequence: 6,
      event_type: "review_completed",
      payload: {
        reviewed_sha: SAMPLE_SHA,
        session_or_run_id: "r1",
        provider: "codex",
        evidence_ref: "e1",
      },
      prev_event_digest: events[events.length - 1].event_digest,
      event_digest: SAMPLE_DIGEST,
    };
    expect(foldTaskState([...events, bad]).ok).toBe(false);
  });

  it("founder_review_ready with SHA mismatch is rejected", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
      { type: "implementation_started" },
      { type: "implementation_declared" },
      { type: "validation_completed" },
      { type: "review_completed" },
      {
        type: "founder_review_ready",
        payload: {
          implementation_sha: SAMPLE_SHA,
          validated_sha: SAMPLE_SHA,
          reviewed_sha: SAMPLE_SHA_B,
          active_contract_version: 1,
          active_contract_digest: SAMPLE_DIGEST,
          closure_evidence_ref: "c1",
          predicate_result_id: "p1",
        },
      },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "founder_review_ready_mismatch")).toBe(
        true,
      );
    }
  });

  it("founder_review_ready with omissions fails schema", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
      { type: "implementation_started" },
      { type: "implementation_declared" },
      { type: "validation_completed" },
      { type: "review_completed" },
    ]);
    const bad = {
      ...events[events.length - 1],
      sequence: 7,
      event_type: "founder_review_ready",
      payload: {
        implementation_sha: SAMPLE_SHA,
        validated_sha: SAMPLE_SHA,
        reviewed_sha: SAMPLE_SHA,
      },
      prev_event_digest: events[events.length - 1].event_digest,
      event_digest: SAMPLE_DIGEST,
    };
    expect(foldTaskState([...events, bad]).ok).toBe(false);
  });

  it("malformed authorize cannot transition to AUTHORIZED", () => {
    const events = chainEvents([{ type: "contract_staged" }]);
    const bad = {
      ...events[0],
      sequence: 2,
      event_type: "authorize",
      payload: { contract_version: 1 },
      prev_event_digest: events[0].event_digest,
      event_digest: SAMPLE_DIGEST,
    };
    const r = foldTaskState([...events, bad]);
    expect(r.ok).toBe(false);
  });

  it("rejects an invalid transition", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "closed" },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].code).toBe("invalid_transition");
  });

  it("supports remediation loop path", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
      { type: "implementation_started" },
      { type: "implementation_declared" },
      {
        type: "validation_completed",
        payload: {
          outcome: "failure",
          validated_sha: SAMPLE_SHA,
          evidence_refs: [{ kind: "check_run", id: "cr-fail" }],
        },
      },
      { type: "remediation_started" },
      {
        type: "implementation_declared",
        payload: {
          implementation_sha: SAMPLE_SHA_B,
          pr_number: 12,
          session_or_run_id: "impl-session-2",
        },
      },
      {
        type: "validation_completed",
        payload: {
          outcome: "success",
          validated_sha: SAMPLE_SHA_B,
          evidence_refs: [{ kind: "check_run", id: "cr-ok" }],
        },
      },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.state).toBe("REVIEWING");
      expect(r.state.remediationCount).toBe(1);
    }
  });

  it("supports founder-decision path", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
      { type: "implementation_started" },
      { type: "founder_decision_required", payload: { question: "scope?" } },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.state).toBe("FOUNDER_DECISION_REQUIRED");
  });

  it("supports cancellation terminal", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "cancelled", payload: { reason: "abandoned", founder_actor_id: 42 } },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.state).toBe("CANCELLED");
  });

  it("supports closed terminal from FOUNDER_REVIEW", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
      { type: "implementation_started" },
      { type: "implementation_declared" },
      { type: "validation_completed" },
      { type: "review_completed" },
      { type: "founder_review_ready" },
      { type: "closed" },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.state).toBe("CLOSED");
  });

  it("rejects events after CLOSED", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
      { type: "implementation_started" },
      { type: "implementation_declared" },
      { type: "validation_completed" },
      { type: "review_completed" },
      { type: "founder_review_ready" },
      { type: "closed" },
      { type: "paused" },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(false);
  });

  it("requires full strict authorize payload to reach AUTHORIZED", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.state).toBe("AUTHORIZED");
  });
});
