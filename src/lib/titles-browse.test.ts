import { describe, expect, it } from "vitest";

import { filterTitles, groupIntoRails, spotlightTitle, type BrowseTitle } from "./titles-browse";

const NOW = new Date("2026-07-22T00:00:00Z");
const mk = (o: Partial<BrowseTitle> & { id: string; title: string }): BrowseTitle => ({
  status: "draft",
  created_at: "2026-01-01T00:00:00Z",
  release_date: null,
  live: 0,
  total: 0,
  posterUrl: null,
  ...o,
});

describe("filterTitles", () => {
  const rows = [mk({ id: "1", title: "Winter's End" }), mk({ id: "2", title: "Meridian" })];
  it("returns all rows for an empty query", () => {
    expect(filterTitles(rows, "  ").map((r) => r.id)).toEqual(["1", "2"]);
  });
  it("matches title case-insensitively (substring)", () => {
    expect(filterTitles(rows, "mer").map((r) => r.id)).toEqual(["2"]);
    expect(filterTitles(rows, "END").map((r) => r.id)).toEqual(["1"]);
  });
});

describe("groupIntoRails", () => {
  const rows: BrowseTitle[] = [
    mk({ id: "live", title: "Live One", live: 2, total: 3, created_at: "2026-06-01T00:00:00Z" }),
    mk({ id: "up", title: "Upcoming One", status: "in_delivery", release_date: "2026-12-01", created_at: "2026-05-01T00:00:00Z" }),
    mk({ id: "rev", title: "Review One", status: "in_review", created_at: "2026-07-01T00:00:00Z" }),
    mk({ id: "draft", title: "Draft One", status: "draft", created_at: "2026-07-10T00:00:00Z" }),
  ];
  it("emits only non-empty rails in priority order", () => {
    expect(groupIntoRails(rows, NOW).map((r) => r.key)).toEqual([
      "recent",
      "live",
      "upcoming",
      "in_review",
      "in_progress",
    ]);
  });
  it("omits rails with no matching titles", () => {
    const keys = groupIntoRails([mk({ id: "d", title: "D", status: "draft" })], NOW).map((r) => r.key);
    expect(keys).toEqual(["recent", "in_progress"]);
  });
  it("sorts the upcoming rail soonest-first", () => {
    const many = [
      mk({ id: "far", title: "Far", status: "in_delivery", release_date: "2027-01-01" }),
      mk({ id: "near", title: "Near", status: "in_delivery", release_date: "2026-09-01" }),
    ];
    const upcoming = groupIntoRails(many, NOW).find((r) => r.key === "upcoming")!;
    expect(upcoming.rows.map((r) => r.id)).toEqual(["near", "far"]);
  });
});

describe("spotlightTitle", () => {
  it("returns null for an empty catalog", () => {
    expect(spotlightTitle([], NOW)).toBeNull();
  });
  it("prefers the soonest upcoming release", () => {
    const rows = [
      mk({ id: "live", title: "L", live: 1, total: 1 }),
      mk({ id: "up", title: "U", status: "in_delivery", release_date: "2026-10-01" }),
    ];
    expect(spotlightTitle(rows, NOW)!.id).toBe("up");
  });
  it("falls back to a live title, then the most recent", () => {
    expect(
      spotlightTitle([mk({ id: "live", title: "L", live: 1 }), mk({ id: "d", title: "D" })], NOW)!.id,
    ).toBe("live");
    expect(
      spotlightTitle(
        [
          mk({ id: "a", title: "A", created_at: "2026-01-01T00:00:00Z" }),
          mk({ id: "b", title: "B", created_at: "2026-07-01T00:00:00Z" }),
        ],
        NOW,
      )!.id,
    ).toBe("b");
  });
});
