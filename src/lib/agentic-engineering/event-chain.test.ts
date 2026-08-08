import { describe, expect, it } from "vitest";

import { verifyEventChain } from "./event-chain";
import { computeEventDigest } from "./event-digest";
import { genesisPrevEventDigest } from "./genesis";
import { chainEvents, SAMPLE_DIGEST, SAMPLE_DIGEST_B } from "./test-fixtures";

describe("verifyEventChain", () => {
  it("accepts a valid chain", () => {
    const events = chainEvents([
      {
        type: "authorize",
        payload: {
          contract_version: 1,
          contract_digest: SAMPLE_DIGEST,
          founder_actor_id: 1,
          base_sha: "a".repeat(40),
          issue_number: 1,
          comment_id: 2,
          authorized_at: "2026-08-08T14:00:00.000Z",
        },
      },
      { type: "implementation_started" },
    ]);
    const r = verifyEventChain(events);
    expect(r.ok).toBe(true);
  });

  it("rejects bad genesis", () => {
    const events = chainEvents([{ type: "contract_staged" }]);
    const broken = {
      ...events[0],
      prev_event_digest: "sha256:" + "0".repeat(64),
    };
    // recompute digest after mutation so failure is prev/genesis, not digest
    const pre = { ...broken, event_digest: undefined };
    delete (pre as { event_digest?: string }).event_digest;
    const recomputed = {
      ...pre,
      event_digest: computeEventDigest(pre),
    };
    const r = verifyEventChain([recomputed]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "bad_genesis")).toBe(true);
    }
  });

  it("rejects sequence gap", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize", payload: { contract_version: 1, contract_digest: SAMPLE_DIGEST } },
    ]);
    const rest = {
      ...events[1],
      sequence: 3,
      prev_event_digest: events[0].event_digest,
    };
    delete (rest as { event_digest?: string }).event_digest;
    const second = {
      ...rest,
      event_digest: computeEventDigest(rest),
    };
    const r = verifyEventChain([events[0], second]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.code === "sequence_gap")).toBe(true);
  });

  it("rejects wrong previous digest", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "implementation_started" },
    ]);
    const rest = {
      ...events[1],
      prev_event_digest: genesisPrevEventDigest("AE-0001"),
    };
    delete (rest as { event_digest?: string }).event_digest;
    const second = { ...rest, event_digest: computeEventDigest(rest) };
    const r = verifyEventChain([events[0], second]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "prev_digest_mismatch")).toBe(true);
    }
  });

  it("rejects mutated prior event (digest mismatch)", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "implementation_started" },
    ]);
    const mutated = {
      ...events[0],
      payload: { tampered: true },
      // keep stale digest
    };
    const r = verifyEventChain([mutated, events[1]]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "event_digest_mismatch")).toBe(true);
    }
  });

  it("rejects task_id change", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "implementation_started" },
    ]);
    const rest = {
      ...events[1],
      task_id: "AE-9999",
    };
    delete (rest as { event_digest?: string }).event_digest;
    const second = { ...rest, event_digest: computeEventDigest(rest) };
    const r = verifyEventChain([events[0], second]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "task_id_mismatch")).toBe(true);
    }
  });

  it("rejects active contract drift without authorize", () => {
    const events = chainEvents([
      { type: "contract_staged", activeDigest: SAMPLE_DIGEST },
      {
        type: "implementation_started",
        activeDigest: SAMPLE_DIGEST_B,
      },
    ]);
    const r = verifyEventChain(events);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "active_contract_drift")).toBe(true);
    }
  });

  it("rejects malformed digest shape via schema", () => {
    const events = chainEvents([{ type: "contract_staged" }]);
    const r = verifyEventChain([
      { ...events[0], event_digest: "not-a-digest" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "malformed_event")).toBe(true);
    }
  });
});
