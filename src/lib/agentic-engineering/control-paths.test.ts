import { describe, expect, it } from "vitest";

import {
  formatContractPath,
  formatEventPath,
  parseControlPath,
} from "./control-paths";
import { SAMPLE_SHA } from "./test-fixtures";

describe("control path grammar", () => {
  it("accepts exact contract / event / closure / proposed forms", () => {
    expect(parseControlPath(formatContractPath("AE-0001", 1))).toMatchObject({
      ok: true,
      class: "contract",
    });
    expect(
      parseControlPath(formatEventPath("AE-0001", 1, "authorize")),
    ).toMatchObject({ ok: true, class: "event" });
    expect(parseControlPath(`closures/AE-0001/${SAMPLE_SHA}.md`)).toMatchObject(
      { ok: true, class: "closure" },
    );
    expect(parseControlPath("proposed/AE-0001/v1.yaml")).toMatchObject({
      ok: true,
      class: "proposed",
    });
  });

  it("rejects leading slash, backslash, dots, empty components", () => {
    expect(parseControlPath("/contracts/AE-0001/v1.yaml").ok).toBe(false);
    expect(parseControlPath("contracts\\AE-0001\\v1.yaml").ok).toBe(false);
    expect(parseControlPath("contracts/./AE-0001/v1.yaml").ok).toBe(false);
    expect(parseControlPath("contracts/../AE-0001/v1.yaml").ok).toBe(false);
    expect(parseControlPath("contracts//AE-0001/v1.yaml").ok).toBe(false);
  });

  it("rejects malformed task IDs / versions / event names / closure SHAs", () => {
    expect(parseControlPath("contracts/AE-1/v1.yaml").ok).toBe(false);
    expect(parseControlPath("contracts/AE-0001/v0.yaml").ok).toBe(false);
    expect(parseControlPath("contracts/AE-0001/v01.yaml").ok).toBe(false);
    expect(parseControlPath("events/AE-0001/1-authorize.json").ok).toBe(false);
    expect(parseControlPath("events/AE-0001/000001-unknown.json").ok).toBe(
      false,
    );
    expect(parseControlPath(`closures/AE-0001/${"A".repeat(40)}.md`).ok).toBe(
      false,
    );
  });

  it("rejects unknown top-level path classes", () => {
    expect(parseControlPath("secrets/AE-0001/x.yaml").ok).toBe(false);
    expect(parseControlPath("contracts/AE-0001/v1.yml").ok).toBe(false);
  });
});
