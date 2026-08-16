import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DashboardDoNext,
  DashboardJustIn,
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
  dashboardJustInDate,
  dashboardTitleStatusLabel,
  DASHBOARD_HOME,
  DASHBOARD_HOME_DO_NEXT,
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
        { org_id: "org-1", entity_id: "live-1", message: "Synopsis is required." },
        { org_id: "org-1", entity_id: "live-1", message: "Genre is required." },
        { org_id: "org-2", entity_id: "other", message: "Director is recommended." },
      ],
      orgId: "org-1",
      now: NOW,
      bound: UNPAGINATED_MAX,
    });

    expect(snap.catalog).toBe(3);
    expect(snap.catalogIsPartial).toBe(false);
    expect(snap.live).toBe(2);
    expect(snap.needsAttention).toBe(1);
    expect(snap.doNext.map((d) => d.id)).toEqual(["live-1", "draft-1"]);
    expect(snap.doNext[0]?.reason).toBe("Synopsis is required.");
    expect(snap.doNext[1]?.reason).toBeNull();
    expect(DASHBOARD_HOME.catalog).toBe("Catalog");
    expect(DASHBOARD_HOME.needsAttention).toBe("Needs attention");
    expect(DASHBOARD_HOME.live).toBe("Live");
  });

  it("marks a bounded catalog and live count as a floor, not a claimed total", () => {
    const titles = Array.from({ length: UNPAGINATED_MAX }, (_, i) =>
      title({ id: `t-${i}`, status: i < 3 ? "draft" : "live" }),
    );
    const snap = clientHomeSnapshot({
      titles,
      findings: [],
      orgId: "org-1",
      now: NOW,
      bound: UNPAGINATED_MAX,
    });
    expect(snap.catalogIsPartial).toBe(true);
    expect(snap.catalog).toBe(UNPAGINATED_MAX);
    expect(snap.live).toBe(UNPAGINATED_MAX - 3);
    expect(dashboardCatalogValue(snap.catalog, snap.catalogIsPartial)).toBe(`${UNPAGINATED_MAX}+`);
    expect(dashboardCatalogValue(snap.live, snap.catalogIsPartial)).toBe(`${UNPAGINATED_MAX - 3}+`);
    expect(dashboardCatalogValue(2, false)).toBe("2");
  });

  it("lists finding rows before leftover drafts and ignores other lifecycle states as drafts", () => {
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
    expect(snap.doNext.map((d) => d.id)).toEqual(["draft", "older-draft"]);
    expect(snap.doNext).toHaveLength(Math.min(2, DASHBOARD_HOME_DRAFTS));
    expect(snap.doNext.every((row) => row.reason === null)).toBe(true);
  });

  it("does not invent a reason when a finding has no existing message", () => {
    const snap = clientHomeSnapshot({
      titles: [title({ id: "live-1", status: "live", title: "Winter Light" })],
      findings: [{ org_id: "org-1", entity_id: "live-1" }],
      orgId: "org-1",
      now: NOW,
      bound: UNPAGINATED_MAX,
    });
    expect(snap.doNext).toEqual([
      { id: "live-1", title: "Winter Light", reason: null, status: "live" },
    ]);
    expect(JSON.stringify(snap.doNext)).not.toMatch(/Artwork missing|Metadata incomplete/i);
  });

  it("prefers an existing high-severity finding message and does not duplicate a draft", () => {
    const snap = clientHomeSnapshot({
      titles: [
        title({
          id: "draft-1",
          title: "Harbor Cut",
          status: "draft",
          created_at: "2026-08-15T10:00:00.000Z",
        }),
      ],
      findings: [
        {
          org_id: "org-1",
          entity_id: "draft-1",
          severity: "low",
          message: "Director is recommended.",
        },
        {
          org_id: "org-1",
          entity_id: "draft-1",
          severity: "high",
          message: "Synopsis is required.",
        },
      ],
      orgId: "org-1",
      now: NOW,
      bound: UNPAGINATED_MAX,
    });
    expect(snap.doNext).toEqual([
      {
        id: "draft-1",
        title: "Harbor Cut",
        reason: "Synopsis is required.",
        status: "draft",
      },
    ]);
  });

  it("caps Do next and keeps just-in titles with their real status", () => {
    const titles = Array.from({ length: DASHBOARD_HOME_DO_NEXT + 2 }, (_, i) =>
      title({
        id: `draft-${i}`,
        status: "draft",
        created_at: `2026-08-15T0${i}:00:00.000Z`,
      }),
    );
    const snap = clientHomeSnapshot({
      titles: [
        ...titles,
        title({
          id: "new",
          status: "live",
          created_at: "2026-08-10T00:00:00.000Z",
        }),
        title({
          id: "old",
          status: "submitted",
          created_at: "2025-01-01T00:00:00.000Z",
        }),
      ],
      findings: [],
      orgId: "org-1",
      now: NOW,
      bound: UNPAGINATED_MAX,
    });
    expect(snap.doNext).toHaveLength(DASHBOARD_HOME_DO_NEXT);
    expect(snap.justIn.map((t) => t.id)).toEqual(titles.map((t) => t.id).reverse().slice(0, 5));
    expect(snap.justIn.every((t) => t.status === "draft")).toBe(true);
    expect(snap.justIn.some((t) => t.id === "new")).toBe(false);
    expect(snap).not.toHaveProperty("upcoming");
    expect(snap).not.toHaveProperty("revenue");
    expect(snap).not.toHaveProperty("createdAt");
  });

  it("keeps the real title status on Just in rows", () => {
    const snap = clientHomeSnapshot({
      titles: [
        title({
          id: "new",
          status: "live",
          created_at: "2026-08-10T00:00:00.000Z",
        }),
        title({
          id: "review",
          status: "in_review",
          created_at: "2026-08-12T00:00:00.000Z",
        }),
      ],
      findings: [],
      orgId: "org-1",
      now: NOW,
      bound: UNPAGINATED_MAX,
    });
    expect(snap.justIn).toEqual([
      {
        id: "review",
        title: "review",
        status: "in_review",
        created_at: "2026-08-12T00:00:00.000Z",
      },
      {
        id: "new",
        title: "new",
        status: "live",
        created_at: "2026-08-10T00:00:00.000Z",
      },
    ]);
  });
});

describe("dashboardIdentityMeta", () => {
  it("joins status and role without inventing a tier or term", () => {
    expect(dashboardIdentityMeta("Active", "Account owner")).toBe("Active · Account owner");
    expect(dashboardIdentityMeta("Registered", null)).toBe("Registered");
    expect(dashboardIdentityMeta("Active", "Account owner")).not.toMatch(/Access|term/i);
  });
});

describe("dashboardTitleStatusLabel", () => {
  it("reuses TITLE_STATUS_LABELS and does not invent a mark", () => {
    expect(dashboardTitleStatusLabel("live")).toBe(TITLE_STATUS_LABELS.live);
    expect(dashboardTitleStatusLabel("in_review")).toBe(TITLE_STATUS_LABELS.in_review);
    expect(dashboardTitleStatusLabel("unknown")).toBeNull();
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
        live: "1",
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
    expect(snapshot).toMatch(/data-dashboard-stat="needsAttention"[^>]*text-accent/);
    expect(snapshot).toMatch(/data-dashboard-stat="catalog"[^>]*text-ink"/);
    expect(snapshot).toMatch(/data-dashboard-stat="live"[^>]*text-ink"/);
  });

  it("keeps Needs attention on accent even when the count is zero", () => {
    const snapshot = renderToStaticMarkup(
      createElement(DashboardSnapshot, {
        catalog: "0",
        needsAttention: 0,
        live: "0",
      }),
    );
    expect(snapshot).toMatch(/data-dashboard-stat="needsAttention"[^>]*text-accent/);
  });

  it("renders Do next as finding + draft rows — no SaaS headline", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardDoNext, {
        items: [
          {
            id: "live-1",
            title: "Winter Light",
            reason: "Synopsis is required.",
            status: "live",
          },
          { id: "draft-1", title: "Draft Work", reason: null, status: "draft" },
        ],
      }),
    );

    expect(html).toContain(`t-label text-ink-3">${DASHBOARD_HOME.doNext}`);
    expect(html).toContain("Winter Light");
    expect(html).toContain("Synopsis is required.");
    expect(html).toContain("Draft Work");
    expect(html).toContain(TITLE_STATUS_LABELS.draft);
    expect(html).toContain(TITLE_STATUS_LABELS.live);
    expect(html).toContain("data-dashboard-status-pill");
    expect(html).toContain("border-hairline");
    expect(html).toContain("t-body font-medium text-ink");
    expect(html).not.toContain(dashboardAttentionSummary(1));
    expect(html).not.toContain("titles need your attention");
    expect(html).not.toContain("Artwork missing");
    expect(html).not.toContain("Metadata incomplete");
    expect(html).not.toContain("t-subhead");
    expect(html).not.toContain("t-display");
    expect(html).not.toContain("t-title");
    expect(html).not.toContain("t-section");
  });

  it("puts a hairline status pill and a date on Just in, not an added prefix", () => {
    const created = "2026-08-12T00:00:00.000Z";
    const html = renderToStaticMarkup(
      createElement(DashboardJustIn, {
        titles: [
          {
            id: "title-1",
            title: "Winter Light",
            status: "submitted",
            created_at: created,
          },
        ],
      }),
    );

    expect(html).toContain(`t-label text-ink-3">${DASHBOARD_HOME.justIn}`);
    expect(html).toContain("Winter Light");
    expect(html).toContain(TITLE_STATUS_LABELS.submitted);
    expect(html).toContain(dashboardJustInDate(created));
    expect(html).toContain("data-dashboard-status-pill");
    expect(html).not.toContain("added ");
    expect(html).not.toMatch(/text-green|bg-green|text-emerald/);
  });
});
