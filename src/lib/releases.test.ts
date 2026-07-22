import { describe, it, expect } from "vitest";

import {
  effectiveReleaseDate,
  displayOriginalDate,
  isUpcoming,
  isNewRelease,
  isJustIn,
  formatReleaseDate,
} from "./releases";

const NOW = new Date("2026-07-21T12:00:00Z");

describe("effectiveReleaseDate", () => {
  it("is the GC-owned release_date", () => {
    expect(effectiveReleaseDate({ release_date: "2026-08-01" })).toBe("2026-08-01");
    expect(effectiveReleaseDate({ release_date: null })).toBeNull();
  });
});

describe("displayOriginalDate", () => {
  it("prefers the historical original, falls back to release_date", () => {
    expect(displayOriginalDate({ original_release_date: "2019-05-01", release_date: "2026-08-01" })).toBe("2019-05-01");
    expect(displayOriginalDate({ original_release_date: null, release_date: "2026-08-01" })).toBe("2026-08-01");
    expect(displayOriginalDate({ original_release_date: null, release_date: null })).toBeNull();
  });
});

describe("isUpcoming", () => {
  it("true only for a future release date", () => {
    expect(isUpcoming("2026-07-22", NOW)).toBe(true);
    expect(isUpcoming("2026-07-21", NOW)).toBe(false); // today is not upcoming
    expect(isUpcoming("2026-07-20", NOW)).toBe(false);
    expect(isUpcoming(null, NOW)).toBe(false);
  });
});

describe("isNewRelease", () => {
  it("true within the trailing 30d window, inclusive of today", () => {
    expect(isNewRelease("2026-07-21", NOW)).toBe(true); // today
    expect(isNewRelease("2026-06-21", NOW)).toBe(true); // exactly 30d ago
    expect(isNewRelease("2026-06-20", NOW)).toBe(false); // 31d ago
    expect(isNewRelease("2026-07-22", NOW)).toBe(false); // future is upcoming, not new
    expect(isNewRelease(null, NOW)).toBe(false);
  });
});

describe("isJustIn", () => {
  it("true when added within the trailing 30d window", () => {
    expect(isJustIn("2026-07-20T09:00:00Z", NOW)).toBe(true);
    expect(isJustIn("2026-05-01T09:00:00Z", NOW)).toBe(false);
  });
});

describe("formatReleaseDate", () => {
  it("renders a plain calendar date without TZ shift, or a dash", () => {
    expect(formatReleaseDate("2026-08-01")).toBe("Aug 1, 2026");
    expect(formatReleaseDate(null)).toBe("—");
  });
});
