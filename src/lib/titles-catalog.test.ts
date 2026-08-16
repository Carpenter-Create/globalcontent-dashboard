import { describe, expect, it } from "vitest";

import { TITLE_STATUS_LABELS, type TitleStatus } from "@/lib/titles";
import {
  CATALOG_LIFECYCLE_STATES,
  TITLES_CATALOG,
  catalogCountLine,
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
  });

  it("does not invent a status or a second catalog label", () => {
    expect(CATALOG_LIFECYCLE_STATES).not.toContain("upcoming");
    expect(CATALOG_LIFECYCLE_STATES).not.toContain("in_progress");
    expect(CATALOG_LIFECYCLE_STATES).not.toContain("approved");
    expect(Object.values(TITLES_CATALOG)).not.toContain("Drafts");
  });
});

describe("catalogStillSrc", () => {
  it("prefers a real banner still", () => {
    expect(catalogStillSrc("https://cdn/banner.jpg", "https://cdn/poster.jpg")).toBe(
      "https://cdn/banner.jpg",
    );
  });

  it("uses a real poster when no banner exists", () => {
    expect(catalogStillSrc(null, "https://cdn/poster.jpg")).toBe("https://cdn/poster.jpg");
  });

  it("returns null when there is no artwork — honest empty, not a fake poster", () => {
    expect(catalogStillSrc(null, null)).toBeNull();
    expect(catalogStillSrc(undefined, "")).toBeNull();
  });
});

describe("catalogCountLine", () => {
  it("names the org and the count", () => {
    expect(catalogCountLine(1, "Acme", false, 200)).toBe("1 title in Acme's catalog.");
    expect(catalogCountLine(3, "Acme", false, 200)).toBe("3 titles in Acme's catalog.");
  });

  it("is honest when the page is truncated", () => {
    expect(catalogCountLine(200, "Acme", true, 200)).toBe(
      "Showing the 200 most recent titles in Acme's catalog.",
    );
  });
});

describe("Add Title copy", () => {
  it("keeps Add Title on the catalog", () => {
    expect(TITLES_CATALOG.addTitle).toBe("Add Title");
    expect(TITLES_CATALOG.title).toBe("Titles");
  });
});
