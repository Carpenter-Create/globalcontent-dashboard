import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DashboardDoNext,
  DashboardOrgIdentity,
  DashboardSnapshot,
} from "@/components/dashboard/dashboard-home";
import { dashboardAttentionSummary } from "@/lib/findings";
import { UNPAGINATED_MAX } from "@/lib/list-bounds";
import { TITLE_STATUS_LABELS } from "@/lib/titles";
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

describe("house type register", () => {
  const tokens = readFileSync("src/app/tokens.css", "utf8");
  const globals = readFileSync("src/app/globals.css", "utf8");

  it("keeps one large moment in the shared --text-* scale", () => {
    expect(tokens).toMatch(/--text-xs:\s*0\.75rem;/);
    expect(tokens).toMatch(/--text-sm:\s*0\.8125rem;/);
    expect(tokens).toMatch(/--text-base:\s*0\.9375rem;/);
    expect(tokens).toMatch(/--text-lg:\s*1\.0625rem;/);
    expect(tokens).toMatch(/--text-title:\s*1\.5rem;/);
    expect(tokens).toMatch(/--text-hero:\s*3rem;/);
  });

  it("binds .t-* steps to those tokens instead of display clamp()", () => {
    expect(globals).toMatch(/\.t-display\s*\{[\s\S]*?font-size:\s*var\(--text-hero\)/);
    expect(globals).toMatch(/\.t-title\s*\{[\s\S]*?font-size:\s*var\(--text-title\)/);
    expect(globals).toMatch(/\.t-section\s*\{[\s\S]*?font-size:\s*var\(--text-title\)/);
    expect(globals).toMatch(/\.t-subhead\s*\{[\s\S]*?font-size:\s*var\(--text-lg\)/);
    expect(globals).toMatch(/\.t-body\s*\{[\s\S]*?font-size:\s*var\(--text-base\)/);
    expect(globals).toMatch(/\.t-body-sm\s*\{[\s\S]*?font-size:\s*var\(--text-sm\)/);
    expect(globals).toMatch(/\.t-label\s*\{[\s\S]*?font-size:\s*var\(--text-xs\)/);
    expect(globals).not.toMatch(
      /\.t-(display|title|statement|section|heading|subhead|lead)\s*\{[^}]*clamp\(/,
    );
  });
});

describe("client home type locks", () => {
  it("makes snapshot numbers the one large moment — org name stays on the title step", () => {
    const identity = renderToStaticMarkup(
      createElement(DashboardOrgIdentity, {
        name: "Acme",
        status: "active",
        role: "account_owner",
      }),
    );
    const snapshot = renderToStaticMarkup(
      createElement(DashboardSnapshot, {
        catalog: "2",
        needsAttention: 1,
        live: 1,
      }),
    );

    expect(identity).toMatch(/<h1 class="t-section text-ink">Acme<\/h1>/);
    expect(identity).not.toContain("t-display");
    expect(identity).not.toContain("t-title");
    expect(snapshot).toMatch(/data-dashboard-stat="catalog"[^>]*t-display t-data/);
    expect(snapshot).toMatch(/data-dashboard-stat="needsAttention"[^>]*t-display t-data/);
    expect(snapshot).toMatch(/data-dashboard-stat="live"[^>]*t-display t-data/);
    expect(snapshot).not.toContain("t-title");
    expect(snapshot).toContain(`t-label text-ink-3">${DASHBOARD_HOME.catalog}`);
    expect(snapshot).toContain(`t-label text-ink-3">${DASHBOARD_HOME.needsAttention}`);
    expect(snapshot).toContain(`t-label text-ink-3">${DASHBOARD_HOME.live}`);
  });

  it("keeps Do next body and list titles on the body step, not display", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardDoNext, {
        attentionTitleCount: 1,
        drafts: [{ id: "draft-1", title: "Draft Work" }],
      }),
    );

    expect(html).toContain(`t-label text-ink-3">${DASHBOARD_HOME.doNext}`);
    expect(html).toContain(dashboardAttentionSummary(1));
    expect(html).toContain("t-body font-medium text-ink");
    expect(html).toContain("Draft Work");
    expect(html).toContain(TITLE_STATUS_LABELS.draft);
    expect(html).not.toContain("t-subhead");
    expect(html).not.toContain("t-display");
    expect(html).not.toContain("t-title");
    expect(html).not.toContain("t-section");
  });
});
