import { describe, expect, it } from "vitest";

import { DAY_MS, cumulativeCatalogSeries } from "./catalog-activity";

const NOW = Date.UTC(2026, 6, 22); // fixed, deterministic
const daysAgo = (n: number) => NOW - n * DAY_MS;

describe("cumulativeCatalogSeries", () => {
  it("returns null for an empty catalog (honest empty state, no faked line)", () => {
    expect(cumulativeCatalogSeries([], NOW, 365)).toBeNull();
  });

  it("counts the whole catalog over the All range, ending at the total", () => {
    const createdAt = [daysAgo(400), daysAgo(200), daysAgo(50), daysAgo(2)];
    const s = cumulativeCatalogSeries(createdAt, NOW, Infinity)!;
    expect(s.total).toBe(4);
    expect(s.added).toBe(4); // all fall inside "all time"
    expect(s.start).toBe(createdAt[0] - 1); // opens just before the earliest title
    expect(s.points[0].c).toBe(0); // line rises from zero
    expect(s.points.at(-1)).toEqual({ t: NOW, c: 4 }); // playhead anchors to now at the total
    expect(s.yMax).toBe(4);
  });

  it("includes titles that predate the window in the starting count", () => {
    // 2 titles before the 30d window, 3 inside it.
    const createdAt = [daysAgo(120), daysAgo(60), daysAgo(20), daysAgo(10), daysAgo(1)];
    const s = cumulativeCatalogSeries(createdAt, NOW, 30)!;
    expect(s.total).toBe(5);
    expect(s.added).toBe(3); // only the 3 within 30 days
    expect(s.points[0].c).toBe(2); // baseline already holds the 2 older titles
    expect(s.points.at(-1)!.c).toBe(5); // ends at the full catalog size
  });

  it("draws a flat line when nothing was added in the window", () => {
    const createdAt = [daysAgo(300), daysAgo(200)]; // both older than 30 days
    const s = cumulativeCatalogSeries(createdAt, NOW, 30)!;
    expect(s.added).toBe(0);
    expect(s.points[0].c).toBe(2);
    expect(s.points.at(-1)!.c).toBe(2); // flat: start == end == total
  });

  it("produces a monotonically non-decreasing cumulative series", () => {
    const createdAt = [daysAgo(365), daysAgo(300), daysAgo(200), daysAgo(100), daysAgo(3)];
    const s = cumulativeCatalogSeries(createdAt, NOW, Infinity)!;
    for (let i = 1; i < s.points.length; i++) {
      expect(s.points[i].c).toBeGreaterThanOrEqual(s.points[i - 1].c);
      expect(s.points[i].t).toBeGreaterThanOrEqual(s.points[i - 1].t);
    }
  });
});
