import { describe, expect, it } from "vitest";

import { computeEventDigest, withEventDigest } from "./event-digest";
import { genesisPrevEventDigest } from "./genesis";
import type { ControlEventPreimage } from "./event-schema";
import { SAMPLE_DIGEST } from "./test-fixtures";

function basePreimage(
  overrides: Partial<ControlEventPreimage> = {},
): ControlEventPreimage {
  return {
    schema_version: 1,
    task_id: "AE-0001",
    sequence: 1,
    event_type: "contract_staged",
    occurred_at: "2026-08-08T14:00:00.000Z",
    actor: {
      kind: "orchestrator",
      provider: "test",
      session_or_run_id: "s1",
      github_actor_id: null,
    },
    active_contract_version: 1,
    active_contract_digest: SAMPLE_DIGEST,
    prev_event_digest: genesisPrevEventDigest("AE-0001"),
    payload: { note: "a" },
    ...overrides,
  };
}

describe("computeEventDigest", () => {
  it("is deterministic", () => {
    const a = computeEventDigest(basePreimage());
    const b = computeEventDigest(basePreimage());
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is independent of object key insertion order", () => {
    const ordered = basePreimage();
    const shuffled = {
      payload: ordered.payload,
      prev_event_digest: ordered.prev_event_digest,
      active_contract_digest: ordered.active_contract_digest,
      active_contract_version: ordered.active_contract_version,
      actor: ordered.actor,
      occurred_at: ordered.occurred_at,
      event_type: ordered.event_type,
      sequence: ordered.sequence,
      task_id: ordered.task_id,
      schema_version: ordered.schema_version,
    };
    expect(computeEventDigest(shuffled)).toBe(computeEventDigest(ordered));
  });

  it("changes when payload changes", () => {
    const a = computeEventDigest(basePreimage({ payload: { note: "a" } }));
    const b = computeEventDigest(basePreimage({ payload: { note: "b" } }));
    expect(a).not.toBe(b);
  });

  it("ignores an existing event_digest when recomputing", () => {
    const pre = basePreimage();
    const d1 = computeEventDigest(pre);
    const contaminated = {
      ...pre,
      event_digest: "sha256:" + "f".repeat(64),
    };
    expect(computeEventDigest(contaminated)).toBe(d1);
  });

  it("withEventDigest attaches a matching digest", () => {
    const ev = withEventDigest(basePreimage());
    expect(ev.event_digest).toBe(computeEventDigest(ev));
  });
});
