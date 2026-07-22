import { describe, expect, it } from "vitest";

import { parseSort, parseView, sortRows, nextSort, buildQuery } from "./catalog-view";

describe("parseSort", () => {
  const allowed = ["title", "release"] as const;
  const fallback = { key: "created", dir: "desc" as const };

  it("accepts an allowed key + valid dir", () => {
    expect(parseSort("title", "asc", allowed, fallback)).toEqual({ key: "title", dir: "asc" });
  });
  it("falls back when the key is not allowed (never trusts the URL)", () => {
    expect(parseSort("evil", "asc", allowed, fallback)).toEqual({ key: "created", dir: "asc" });
  });
  it("falls back the dir when invalid", () => {
    expect(parseSort("title", "sideways", allowed, fallback)).toEqual({ key: "title", dir: "desc" });
  });
});

describe("parseView", () => {
  it("accepts browse/table, falls back otherwise", () => {
    expect(parseView("table", "browse")).toBe("table");
    expect(parseView("browse", "table")).toBe("browse");
    expect(parseView(undefined, "browse")).toBe("browse");
    expect(parseView("grid", "browse")).toBe("browse"); // old value no longer valid
  });
});

describe("sortRows", () => {
  const rows = [
    { id: "a", n: 3, s: "Beta", d: "2026-03-01" },
    { id: "b", n: 1, s: "alpha", d: null },
    { id: "c", n: 2, s: "Gamma", d: "2026-01-01" },
  ];

  it("sorts numbers asc and desc", () => {
    expect(sortRows(rows, (r) => r.n, "asc").map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortRows(rows, (r) => r.n, "desc").map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("sorts strings case-insensitively via localeCompare", () => {
    expect(sortRows(rows, (r) => r.s.toLowerCase(), "asc").map((r) => r.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("always puts null/empty values last, regardless of direction", () => {
    expect(sortRows(rows, (r) => r.d, "asc").map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sortRows(rows, (r) => r.d, "desc").map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("is stable for equal keys and does not mutate the input", () => {
    const eq = [{ id: "x", n: 1 }, { id: "y", n: 1 }, { id: "z", n: 1 }];
    const before = [...eq];
    expect(sortRows(eq, (r) => r.n, "asc").map((r) => r.id)).toEqual(["x", "y", "z"]);
    expect(sortRows(eq, (r) => r.n, "desc").map((r) => r.id)).toEqual(["x", "y", "z"]);
    expect(eq).toEqual(before); // untouched
  });
});

describe("nextSort", () => {
  it("toggles direction when re-clicking the active key", () => {
    expect(nextSort({ key: "title", dir: "asc" }, "title")).toEqual({ key: "title", dir: "desc" });
    expect(nextSort({ key: "title", dir: "desc" }, "title")).toEqual({ key: "title", dir: "asc" });
  });
  it("uses the column's initial dir when switching keys", () => {
    expect(nextSort({ key: "title", dir: "asc" }, "live", "desc")).toEqual({
      key: "live",
      dir: "desc",
    });
  });
});

describe("buildQuery", () => {
  it("drops empty/undefined values and prefixes with ?", () => {
    expect(buildQuery({ view: "table", sort: "title", dir: undefined, x: "" })).toBe(
      "?view=table&sort=title",
    );
  });
  it("returns an empty string when nothing is set", () => {
    expect(buildQuery({ view: undefined, sort: "" })).toBe("");
  });
});
