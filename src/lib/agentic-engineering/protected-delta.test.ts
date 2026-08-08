import { describe, expect, it } from "vitest";

import { formatEventPath } from "./control-paths";
import { verifyProtectedObjectDelta } from "./protected-delta";
import { SAMPLE_SHA } from "./test-fixtures";

const e1 = formatEventPath("AE-0001", 1, "contract_staged");
const e2 = formatEventPath("AE-0001", 2, "authorize");
const c1 = "contracts/AE-0001/v1.yaml";
const c2 = "contracts/AE-0001/v2.yaml";
const closure = `closures/AE-0001/${SAMPLE_SHA}.md`;

describe("verifyProtectedObjectDelta", () => {
  it("allows appending a new event file", () => {
    const prior = new Map([[e1, "d1"]]);
    const next = new Map([
      [e1, "d1"],
      [e2, "d2"],
    ]);
    expect(verifyProtectedObjectDelta(prior, next).ok).toBe(true);
  });

  it("allows appending a new contract version file", () => {
    const prior = new Map([[c1, "c1"]]);
    const next = new Map([
      [c1, "c1"],
      [c2, "c2"],
    ]);
    expect(verifyProtectedObjectDelta(prior, next).ok).toBe(true);
  });

  it("rejects modifying an old event", () => {
    const prior = new Map([[e1, "d1"]]);
    const next = new Map([[e1, "d1-mutated"]]);
    const r = verifyProtectedObjectDelta(prior, next);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].code).toBe("protected_modified");
  });

  it("rejects deleting an old event", () => {
    const prior = new Map([[e1, "d1"]]);
    const next = new Map();
    const r = verifyProtectedObjectDelta(prior, next);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].code).toBe("protected_deleted");
  });

  it("rejects modifying an old contract", () => {
    const prior = new Map([[c1, "c1"]]);
    const next = new Map([[c1, "c1x"]]);
    expect(verifyProtectedObjectDelta(prior, next).ok).toBe(false);
  });

  it("rejects deleting an old contract", () => {
    const prior = new Map([[c1, "c1"]]);
    const next = new Map();
    expect(verifyProtectedObjectDelta(prior, next).ok).toBe(false);
  });

  it("rejects rename (delete + add same digest)", () => {
    const prior = new Map([[e1, "d1"]]);
    const next = new Map([
      [formatEventPath("AE-0001", 99, "authorize"), "d1"],
    ]);
    const r = verifyProtectedObjectDelta(prior, next);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.issues.some(
          (i) =>
            i.code === "protected_renamed" || i.code === "protected_deleted",
        ),
      ).toBe(true);
    }
  });

  it("allows derived closure refresh", () => {
    const prior = new Map([
      [e1, "d1"],
      [closure, "old"],
    ]);
    const next = new Map([
      [e1, "d1"],
      [closure, "new"],
    ]);
    expect(verifyProtectedObjectDelta(prior, next).ok).toBe(true);
  });

  it("fails closed on unknown protected/control-plane path classes", () => {
    const prior = new Map([[e1, "d1"]]);
    const next = new Map([
      [e1, "d1"],
      ["audit/AE-0001/x.json", "x"],
    ]);
    const r = verifyProtectedObjectDelta(prior, next);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === "invalid_path")).toBe(true);
    }
  });

  it("rejects path normalization / traversal bypasses", () => {
    for (const path of [
      "/contracts/AE-0001/v1.yaml",
      "contracts/../contracts/AE-0001/v1.yaml",
      "contracts/AE-0001/./v1.yaml",
      "contracts//AE-0001/v1.yaml",
      "contracts\\AE-0001\\v1.yaml",
      "events/AE-0001/1-authorize.json",
      "events/AE-1/000001-authorize.json",
      `closures/AE-0001/${"a".repeat(39)}.md`,
    ]) {
      const r = verifyProtectedObjectDelta(new Map(), new Map([[path, "d"]]));
      expect(r.ok, path).toBe(false);
    }
  });
});
