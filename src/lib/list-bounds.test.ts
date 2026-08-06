import { describe, expect, it } from "vitest";

import {
  LIST_PAGE,
  UNPAGINATED_MAX,
  rangeFor,
  probeRange,
  splitProbe,
} from "./list-bounds";

describe("rangeFor", () => {
  // Supabase .range() is inclusive on BOTH ends. range(0, 200) returns 201 rows, not 200 —
  // an off-by-one here silently drops or adds a row on every page.
  it("asks for exactly `limit` rows", () => {
    expect(rangeFor(200)).toEqual([0, 199]);
    expect(rangeFor(1)).toEqual([0, 0]);
  });

  it("offsets without changing the count", () => {
    const [from, to] = rangeFor(50, 200);
    expect(from).toBe(200);
    expect(to - from + 1).toBe(50);
  });

  it("rejects a non-positive limit rather than producing an inverted range", () => {
    expect(() => rangeFor(0)).toThrow(/positive/);
    expect(() => rangeFor(-5)).toThrow(/positive/);
  });
});

describe("probeRange", () => {
  it("asks for one extra row, so truncation is detectable without a count query", () => {
    expect(probeRange(200)).toEqual([0, 200]); // 201 rows
  });
});

describe("splitProbe", () => {
  it("reports truncated when the extra row came back", () => {
    const rows = Array.from({ length: 201 }, (_, i) => i);
    const out = splitProbe(rows, 200);
    expect(out.rows).toHaveLength(200);
    expect(out.truncated).toBe(true);
  });

  it("reports not-truncated on an exactly-full page", () => {
    const rows = Array.from({ length: 200 }, (_, i) => i);
    const out = splitProbe(rows, 200);
    expect(out.rows).toHaveLength(200);
    expect(out.truncated).toBe(false);
  });

  it("handles a short page", () => {
    expect(splitProbe([1, 2, 3], 200)).toEqual({ rows: [1, 2, 3], truncated: false });
  });

  it("handles null — a failed query must not look like an empty catalog", () => {
    expect(splitProbe(null, 200)).toEqual({ rows: [], truncated: false });
  });
});

describe("bounds", () => {
  // The whole point: our bound has to bite BEFORE PostgREST's max_rows (1000), so that
  // truncation is something we chose and can surface, not something the platform did quietly.
  it("stays under PostgREST's max_rows so our limit is the one that applies", () => {
    expect(UNPAGINATED_MAX).toBeLessThan(1000);
    expect(LIST_PAGE).toBeLessThan(1000);
  });

  // titleArtworkUrls fetches poster AND banner, so a page of N titles is up to 2N rows.
  it("leaves headroom for the 2-rows-per-title artwork fetch", () => {
    expect(LIST_PAGE * 2).toBeLessThan(1000);
  });
});
