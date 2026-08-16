import { describe, expect, it } from "vitest";

import { UNPAGINATED_MAX } from "@/lib/list-bounds";
import {
  clientHomeSnapshot,
  dashboardCatalogValue,
  dashboardIdentityMeta,
  DASHBOARD_HOME,
  DASHBOARD_HOME_DRAFTS,
} from "./dashboard-home";

const NOW = new Date("2026-08-16T12:00:00.000Z");

function title(partial: {
  id: string;
  title?: string;
  status?: string;
  created_at?: string;
}) {
  return {
    title: partial.title ?? partial.id,
    status: partial.status ?? "draft",
    created_at: partial.created_at ?? "2026-08-15T00:00:00.000Z",
    ...partial,
  };
}

describe("clientHomeSnapshot", () => {
  it("counts catalog, live, and org-scoped attention titles from existing rows", () => {
    const snap = clientHomeSnapshot({
      titles: [
        title({ id: "live-1", status: "live" }),
        title({ id: "draft-1", status: "draft" }),
        title({ id: "live-2", status: "live" }),
      ],
      findings: [
        { org_id: "org-1", entity_id: "live-1" },
        { org_id: "org-1", entity_id: "live-1" },
        { org_id: "org-2", entity_id: "other" },
      ],
      orgId: "org-1",
      now: NOW,
      bound: UNPAGINATED_MAX,
    });

    expect(snap.catalog).toBe(3);
    expect(snap.catalogIsPartial).toBe(false);
    expect(snap.live).toBe(2);
    expect(snap.needsAttention).toBe(1);
    expect(snap.drafts.map((d) => d.id)).toEqual(["draft-1"]);
    expect(DASHBOARD_HOME.catalog).toBe("Catalog");
    expect(DASHBOARD_HOME.needsAttention).toBe("Needs attention");
    expect(DASHBOARD_HOME.live).toBe("Live");
  });

  it("marks a bounded catalog as a floor, not a claimed total", () => {
    const titles = Array.from({ length: UNPAGINATED_MAX }, (_, i) =>
      title({ id: `t-${i}`, status: "live" }),
    );
    const snap = clientHomeSnapshot({
      titles,
      findings: [],
      orgId: "org-1",
      now: NOW,
      bound: UNPAGINATED_MAX,
    });
    expect(snap.catalogIsPartial).toBe(true);
    expect(dashboardCatalogValue(snap.catalog, snap.catalogIsPartial)).toBe(`${UNPAGINATED_MAX}+`);
  });

  it("lists only draft-status titles and ignores other lifecycle states", () => {
    const snap = clientHomeSnapshot({
      titles: [
        title({ id: "draft", status: "draft", created_at: "2026-08-15T10:00:00.000Z" }),
        title({ id: "submitted", status: "submitted", created_at: "2026-08-15T11:00:00.000Z" }),
        title({ id: "in-review", status: "in_review", created_at: "2026-08-15T12:00:00.000Z" }),
        title({ id: "older-draft", status: "draft", created_at: "2026-08-14T00:00:00.000Z" }),
      ],
      findings: [],
      orgId: "org-1",
      now: NOW,
      bound: UNPAGINATED_MAX,
    });
    expect(snap.drafts.map((d) => d.id)).toEqual(["draft", "older-draft"]);
    expect(snap.drafts).toHaveLength(Math.min(2, DASHBOARD_HOME_DRAFTS));
  });

  it("keeps just-in titles and does not invent upcoming or revenue", () => {
    const snap = clientHomeSnapshot({
      titles: [
        title({
          id: "new",
          status: "live",
          created_at: "2026-08-10T00:00:00.000Z",
        }),
        title({
          id: "old",
          status: "live",
          created_at: "2025-01-01T00:00:00.000Z",
        }),
      ],
      findings: [],
      orgId: "org-1",
      now: NOW,
      bound: UNPAGINATED_MAX,
    });
    expect(snap.justIn.map((t) => t.id)).toEqual(["new"]);
    expect(snap).not.toHaveProperty("upcoming");
    expect(snap).not.toHaveProperty("revenue");
    expect(snap).not.toHaveProperty("createdAt");
  });
});

describe("dashboardIdentityMeta", () => {
  it("joins status and role without inventing a tier or term", () => {
    expect(dashboardIdentityMeta("Active", "Account owner")).toBe("Active · Account owner");
    expect(dashboardIdentityMeta("Registered", null)).toBe("Registered");
    expect(dashboardIdentityMeta("Active", "Account owner")).not.toMatch(/Access|term/i);
  });
});
