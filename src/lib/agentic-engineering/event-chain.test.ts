import { describe, expect, it } from "vitest";

import { verifyEventChain } from "./event-chain";
import { computeEventDigest } from "./event-digest";
import { genesisPrevEventDigest } from "./genesis";
import {
  authorizePayload,
  chainEvents,
  SAMPLE_DIGEST,
  SAMPLE_DIGEST_B,
} from "./test-fixtures";

describe("verifyEventChain", () => {
  it("accepts a valid chain", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize", payload: authorizePayload() },
      { type: "implementation_started" },
    ]);
    const r = verifyEventChain(events);
    expect(r.ok).toBe(true);
  });

  it("schema validation occurs before digest/chain acceptance", () => {
    const events = chainEvents([{ type: "contract_staged" }]);
    const bad = {
      ...events[0],
      sequence: 2,
      event_type: "authorize",
      payload: { decision: "yes" },
      prev_event_digest: events[0].event_digest,
      event_digest: SAMPLE_DIGEST,
    };
    const r = verifyEventChain([...events, bad]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "malformed_event")).toBe(true);
    }
  });

  it("unsupported / malformed authority payloads invalidate the chain", () => {
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
      payload: { ok: true },
      prev_event_digest: events[events.length - 1].event_digest,
      event_digest: SAMPLE_DIGEST,
    };
    const r = verifyEventChain([...events, bad]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "malformed_event")).toBe(true);
    }
  });

  it("rejects reordered events", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
      { type: "implementation_started" },
    ]);
    const r = verifyEventChain([events[0], events[2], events[1]]);
    expect(r.ok).toBe(false);
  });

  it("rejects removed middle event (sequence gap)", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize" },
      { type: "implementation_started" },
    ]);
    const r = verifyEventChain([events[0], events[2]]);
    expect(r.ok).toBe(false);
  });

  it("rejects bad genesis", () => {
    const events = chainEvents([{ type: "contract_staged" }]);
    const broken = {
      ...events[0],
      prev_event_digest: "sha256:" + "0".repeat(64),
    };
    const pre = { ...broken };
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
      { type: "authorize", payload: authorizePayload() },
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
      { type: "authorize" },
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
      { type: "authorize" },
    ]);
    const mutated = {
      ...events[0],
      payload: {
        contract_version: 1,
        contract_digest: SAMPLE_DIGEST_B,
      },
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
      { type: "authorize" },
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

  it("allows pre-auth contract_staged to advance proposed active pins", () => {
    const events = chainEvents([
      {
        type: "contract_staged",
        activeVersion: 1,
        activeDigest: SAMPLE_DIGEST,
        payload: { contract_version: 1, contract_digest: SAMPLE_DIGEST },
      },
      {
        type: "contract_staged",
        activeVersion: 2,
        activeDigest: SAMPLE_DIGEST_B,
        payload: { contract_version: 2, contract_digest: SAMPLE_DIGEST_B },
      },
    ]);
    const r = verifyEventChain(events);
    expect(r.ok).toBe(true);
  });

  it("rejects post-auth pin change via contract_staged", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      { type: "authorize", payload: authorizePayload() },
      {
        type: "contract_staged",
        activeVersion: 2,
        activeDigest: SAMPLE_DIGEST_B,
        payload: { contract_version: 2, contract_digest: SAMPLE_DIGEST_B },
      },
    ]);
    const r = verifyEventChain(events);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "active_contract_drift")).toBe(true);
    }
  });

  it("enforces authorize binding to active_contract_*", () => {
    const events = chainEvents([
      { type: "contract_staged" },
      {
        type: "authorize",
        payload: authorizePayload({
          contract_digest: SAMPLE_DIGEST_B,
        }),
      },
    ]);
    const r = verifyEventChain(events);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "authorize_digest_bind")).toBe(true);
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
