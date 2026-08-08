import { describe, expect, it } from "vitest";

import { verifyProtectedObjectDelta } from "./protected-delta";

describe("verifyProtectedObjectDelta", () => {
  it("allows appending a new event file", () => {
    const prior = new Map([["events/AE-0001/001.json", "d1"]]);
    const next = new Map([
      ["events/AE-0001/001.json", "d1"],
      ["events/AE-0001/002.json", "d2"],
    ]);
    expect(verifyProtectedObjectDelta(prior, next).ok).toBe(true);
  });

  it("allows appending a new contract version file", () => {
    const prior = new Map([["contracts/AE-0001/v1.yaml", "c1"]]);
    const next = new Map([
      ["contracts/AE-0001/v1.yaml", "c1"],
      ["contracts/AE-0001/v2.yaml", "c2"],
    ]);
    expect(verifyProtectedObjectDelta(prior, next).ok).toBe(true);
  });

  it("rejects modifying an old event", () => {
    const prior = new Map([["events/AE-0001/001.json", "d1"]]);
    const next = new Map([["events/AE-0001/001.json", "d1-mutated"]]);
    const r = verifyProtectedObjectDelta(prior, next);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].code).toBe("protected_modified");
  });

  it("rejects deleting an old event", () => {
    const prior = new Map([["events/AE-0001/001.json", "d1"]]);
    const next = new Map();
    const r = verifyProtectedObjectDelta(prior, next);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].code).toBe("protected_deleted");
  });

  it("rejects modifying an old contract", () => {
    const prior = new Map([["contracts/AE-0001/v1.yaml", "c1"]]);
    const next = new Map([["contracts/AE-0001/v1.yaml", "c1x"]]);
    expect(verifyProtectedObjectDelta(prior, next).ok).toBe(false);
  });

  it("rejects deleting an old contract", () => {
    const prior = new Map([["contracts/AE-0001/v1.yaml", "c1"]]);
    const next = new Map();
    expect(verifyProtectedObjectDelta(prior, next).ok).toBe(false);
  });

  it("rejects rename (delete + add same digest)", () => {
    const prior = new Map([["events/AE-0001/001.json", "d1"]]);
    const next = new Map([["events/AE-0001/001-renamed.json", "d1"]]);
    const r = verifyProtectedObjectDelta(prior, next);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "protected_renamed" || i.code === "protected_deleted")).toBe(
        true,
      );
    }
  });

  it("allows derived closure refresh", () => {
    const prior = new Map([
      ["events/AE-0001/001.json", "d1"],
      ["closures/AE-0001/aaa.md", "old"],
    ]);
    const next = new Map([
      ["events/AE-0001/001.json", "d1"],
      ["closures/AE-0001/aaa.md", "new"],
    ]);
    expect(verifyProtectedObjectDelta(prior, next).ok).toBe(true);
  });
});
