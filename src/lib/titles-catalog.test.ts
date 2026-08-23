import { describe, expect, it } from "vitest";

import { TITLE_STATUS_LABELS, type TitleStatus } from "@/lib/titles";
import { DASHBOARD_HOME } from "./dashboard-home";
import {
  CATALOG_LIFECYCLE_STATES,
  TITLES_CATALOG,
  catalogCountLabel,
  catalogCountValue,
  catalogReleaseYear,
  catalogStatusMark,
  catalogStillSrc,
} from "./titles-catalog";

const ALL_STATES: TitleStatus[] = [
  "draft",
  "submitted",
  "in_review",
  "in_delivery",
  "live",
  "takedown_requested",
  "taken_down",
];

describe("catalog lifecycle", () => {
  it("keeps every existing title.status on one catalog list", () => {
    expect([...CATALOG_LIFECYCLE_STATES]).toEqual(ALL_STATES);
    const list = ALL_STATES.map((status) => ({ id: status, status }));
    expect(list.map((row) => row.status)).toEqual(ALL_STATES);
    expect(list).toHaveLength(7);
  });

  it("surfaces founder-decided labels for each existing status", () => {
    for (const status of ALL_STATES) {
      expect(catalogStatusMark(status)).toBe(TITLE_STATUS_LABELS[status]);
    }
    expect(catalogStatusMark("draft")).toBe("Draft");
    expect(catalogStatusMark("submitted")).toBe("Submitted");
    expect(catalogStatusMark("in_review")).toBe("In review");
    expect(catalogStatusMark("in_delivery")).toBe("Submitted");
    expect(catalogStatusMark("live")).toBe("Live");
    expect(catalogStatusMark("takedown_requested")).toBe("Takedown requested");
    expect(catalogStatusMark("taken_down")).toBe("Taken down");
    expect(ALL_STATES.map(catalogStatusMark)).not.toContain("Delivered");
    const unique = [...new Set(ALL_STATES.map(catalogStatusMark))];
    expect(unique).toEqual([
      "Draft",
      "Submitted",
      "In review",
      "Live",
      "Takedown requested",
      "Taken down",
    ]);
    expect(unique).toHaveLength(6);
  });

  it("does not invent a status or a second catalog label", () => {
    expect(CATALOG_LIFECYCLE_STATES).not.toContain("upcoming");
    expect(CATALOG_LIFECYCLE_STATES).not.toContain("in_progress");
    expect(CATALOG_LIFECYCLE_STATES).not.toContain("approved");
    expect(Object.values(TITLES_CATALOG)).not.toContain("Drafts");
  });
});

describe("catalogStillSrc", () => {
  it("prefers a real poster for the portrait still", () => {
    expect(catalogStillSrc("https://cdn/banner.jpg", "https://cdn/poster.jpg")).toBe(
      "https://cdn/poster.jpg",
    );
  });

  it("uses a real banner when no poster exists", () => {
    expect(catalogStillSrc("https://cdn/banner.jpg", null)).toBe("https://cdn/banner.jpg");
  });

  it("returns null when there is no artwork — honest empty, not a fake poster", () => {
    expect(catalogStillSrc(null, null)).toBeNull();
    expect(catalogStillSrc(undefined, "")).toBeNull();
  });
});

describe("catalogReleaseYear", () => {
  it("returns the calendar year from titles.release_date", () => {
    expect(catalogReleaseYear("2019-05-01")).toBe("2019");
    expect(catalogReleaseYear("2026-12-31")).toBe("2026");
  });

  it("omits a year when release_date is null or not a calendar date", () => {
    expect(catalogReleaseYear(null)).toBeNull();
    expect(catalogReleaseYear(undefined)).toBeNull();
    expect(catalogReleaseYear("")).toBeNull();
    expect(catalogReleaseYear("2019")).toBeNull();
    expect(catalogReleaseYear("2019-05")).toBeNull();
    expect(catalogReleaseYear("May 2019")).toBeNull();
    expect(catalogReleaseYear("2026-08-10T00:00:00Z")).toBeNull();
  });
});

describe("Add Title copy", () => {
  it("keeps Add Title on the catalog", () => {
    expect(TITLES_CATALOG.addTitle).toBe("Add Title");
    expect(TITLES_CATALOG.title).toBe("Titles");
    expect(TITLES_CATALOG.searchPlaceholder).toBe("Search titles...");
  });

  it("locks mobile 528:542 Recent and empty 529:542 copy to the home phrases", () => {
    expect(TITLES_CATALOG.recent).toBe("Recent");
    expect(TITLES_CATALOG.recent).not.toBe("Recently added");
    expect(TITLES_CATALOG.emptyCatalog).toBe("The catalog is empty.");
    expect(TITLES_CATALOG.recent).toBe(DASHBOARD_HOME.justIn);
    expect(TITLES_CATALOG.emptyCatalog).toBe(DASHBOARD_HOME.catalogEmpty);
    expect(TITLES_CATALOG.emptyCatalog).not.toBe(TITLES_CATALOG.empty);
    expect(TITLES_CATALOG.emptyCatalog).not.toBe(TITLES_CATALOG.emptyCanOperate);
  });
});

describe("catalog count chrome", () => {
  it("names the real count and marks a bounded read as a floor", () => {
    expect(catalogCountValue(7, false)).toBe("7");
    expect(catalogCountValue(200, true)).toBe("200+");
    expect(catalogCountLabel(7, false)).toBe("7 in catalog");
    expect(catalogCountLabel(200, true)).toBe("200+ in catalog");
    expect(catalogCountLabel(0, false)).toBe("0 in catalog");
    expect(catalogCountLabel(7, false)).not.toBe("10 in catalog");
  });
});
