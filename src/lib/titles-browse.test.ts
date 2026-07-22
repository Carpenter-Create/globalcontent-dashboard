import { describe, expect, it } from "vitest";

import {
  filterTitles,
  groupIntoRails,
  spotlightTitle,
  filterByStatus,
  parseStatusFilter,
  type BrowseTitle,
} from "./titles-browse";

const NOW = new Date("2026-07-22T00:00:00Z");
const mk = (o: Partial<BrowseTitle> & { id: string; title: string }): BrowseTitle => ({
  status: "draft",
  created_at: "2026-01-01T00:00:00Z",
  release_date: null,
  live: 0,
  total: 0,
  posterUrl: null,
  bannerUrl: null,
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
      mk({ id: "far", title: "F", status: "in_delivery", release_date: "2027-01-01" }),
      mk({ id: "near", title: "N", status: "in_delivery", release_date: "2026-10-01" }),
    ];
    expect(spotlightTitle(rows, NOW)!.id).toBe("near");
  });
  it("falls back to the most-recently-added title when nothing is upcoming", () => {
    const rows = [
      mk({ id: "old", title: "Old", created_at: "2026-01-01T00:00:00Z" }),
      mk({ id: "new", title: "New", created_at: "2026-07-01T00:00:00Z" }),
    ];
    expect(spotlightTitle(rows, NOW)!.id).toBe("new");
  });
  it("prefers a title WITH a banner within the chosen pool", () => {
    // No upcoming → recency pool; the most-recent has no banner, an older one does → pick the bannered one.
    const rows = [
      mk({ id: "new-nobanner", title: "New", created_at: "2026-07-01T00:00:00Z" }),
      mk({ id: "old-banner", title: "Old", created_at: "2026-01-01T00:00:00Z", bannerUrl: "https://cdn/x.jpg" }),
    ];
    expect(spotlightTitle(rows, NOW)!.id).toBe("old-banner");
  });
});

describe("parseStatusFilter", () => {
  it("accepts known filters, falls back to all", () => {
    expect(parseStatusFilter("live")).toBe("live");
    expect(parseStatusFilter("in_review")).toBe("in_review");
    expect(parseStatusFilter(undefined)).toBe("all");
    expect(parseStatusFilter("bogus")).toBe("all");
  });
});

describe("filterByStatus", () => {
  const rows: BrowseTitle[] = [
    mk({ id: "live", title: "Live", live: 1, total: 2 }),
    mk({ id: "up", title: "Up", status: "in_delivery", release_date: "2026-12-01" }),
    mk({ id: "rev", title: "Rev", status: "in_review" }),
    mk({ id: "draft", title: "Draft", status: "draft" }),
  ];
  it("passes everything for 'all'", () => {
    expect(filterByStatus(rows, "all", NOW)).toHaveLength(4);
  });
  it("filters to each category", () => {
    expect(filterByStatus(rows, "live", NOW).map((r) => r.id)).toEqual(["live"]);
    expect(filterByStatus(rows, "upcoming", NOW).map((r) => r.id)).toEqual(["up"]);
    expect(filterByStatus(rows, "in_review", NOW).map((r) => r.id)).toEqual(["rev"]);
    // in_progress = not live, and draft/submitted/in_delivery (the upcoming one is in_delivery)
    expect(filterByStatus(rows, "in_progress", NOW).map((r) => r.id).sort()).toEqual(["draft", "up"]);
  });
});
