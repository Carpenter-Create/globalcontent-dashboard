import { describe, expect, it } from "vitest";

import { foldTaskState } from "./state-fold";
import { chainEvents, SAMPLE_DIGEST, SAMPLE_SHA } from "./test-fixtures";

function authorizePayload() {
  return {
    contract_version: 1,
    contract_digest: SAMPLE_DIGEST,
    founder_actor_id: 42,
    base_sha: SAMPLE_SHA,
    issue_number: 7,
    comment_id: 99,
    authorized_at: "2026-08-08T14:00:00.000Z",
  };
}

describe("foldTaskState", () => {
  it("folds a normal happy path to FOUNDER_REVIEW", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize", payload: authorizePayload() },
      { type: "implementation_started", payload: { pr_number: 12 } },
      {
        type: "implementation_declared",
        payload: { implementation_sha: SAMPLE_SHA, pr_number: 12 },
      },
      {
        type: "validation_completed",
        payload: { ok: true, validated_sha: SAMPLE_SHA },
      },
      { type: "review_started" },
      {
        type: "review_completed",
        payload: { status: "approved", reviewed_sha: SAMPLE_SHA },
      },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.state).toBe("FOUNDER_REVIEW");
      expect(r.state.implementationSha).toBe(SAMPLE_SHA);
      expect(r.state.reviewedSha).toBe(SAMPLE_SHA);
    }
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
      { type: "authorize", payload: authorizePayload() },
      { type: "implementation_started" },
      {
        type: "implementation_declared",
        payload: { implementation_sha: SAMPLE_SHA },
      },
      {
        type: "validation_completed",
        payload: { ok: false },
      },
      { type: "remediation_started" },
      {
        type: "implementation_declared",
        payload: { implementation_sha: "b".repeat(40) },
      },
      {
        type: "validation_completed",
        payload: { ok: true, validated_sha: "b".repeat(40) },
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
      { type: "authorize", payload: authorizePayload() },
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
      { type: "cancelled", payload: { reason: "abandoned" } },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.state).toBe("CANCELLED");
  });

  it("supports closed terminal from FOUNDER_REVIEW", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize", payload: authorizePayload() },
      { type: "implementation_started" },
      {
        type: "implementation_declared",
        payload: { implementation_sha: SAMPLE_SHA },
      },
      {
        type: "validation_completed",
        payload: { ok: true, validated_sha: SAMPLE_SHA },
      },
      {
        type: "review_completed",
        payload: { status: "approved", reviewed_sha: SAMPLE_SHA },
      },
      { type: "closed", payload: { merge_sha: SAMPLE_SHA } },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.state).toBe("CLOSED");
  });

  it("rejects events after CLOSED", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize", payload: authorizePayload() },
      { type: "implementation_started" },
      {
        type: "implementation_declared",
        payload: { implementation_sha: SAMPLE_SHA },
      },
      {
        type: "validation_completed",
        payload: { ok: true, validated_sha: SAMPLE_SHA },
      },
      {
        type: "review_completed",
        payload: { status: "approved", reviewed_sha: SAMPLE_SHA },
      },
      { type: "closed" },
      { type: "paused" },
    ]);
    const r = foldTaskState(events);
    expect(r.ok).toBe(false);
  });
});
