import { isJustIn } from "@/lib/releases";

// Client `/` portfolio copy and snapshot derivation. Lives in lib/, not JSX.
// Org context has id / name / status / role only — no contract tier or term.
// Do not invent Access, a term line, upcoming, revenue, or a "stuck too long" metric.

export const DASHBOARD_HOME = {
  justIn: "Just in",
  justInEmpty: "No titles added recently.",
  addedPrefix: "added",
  attentionReview: "Review what needs attention across your catalog.",
  catalogHealthCta: "Catalog Health",
  catalog: "Catalog",
  needsAttention: "Needs attention",
  live: "Live",
  doNext: "Do next",
} as const;

export const DASHBOARD_HOME_DRAFTS = 5;
export const DASHBOARD_HOME_JUST_IN = 5;

export type ClientHomeTitle = {
  id: string;
  title: string;
  status: string;
  created_at: string;
};

export type ClientHomeFinding = {
  org_id: string;
  entity_id: string;
};

export type ClientHomeSnapshot = {
  catalog: number;
  catalogIsPartial: boolean;
  needsAttention: number;
  live: number;
  drafts: { id: string; title: string }[];
  justIn: { id: string; title: string; created_at: string }[];
};

export function dashboardIdentityMeta(statusLabel: string, roleLabel: string | null): string {
  return roleLabel ? `${statusLabel} · ${roleLabel}` : statusLabel;
}

export function dashboardCatalogValue(catalog: number, catalogIsPartial: boolean): string {
  return catalogIsPartial ? `${catalog}+` : String(catalog);
}

/**
 * Org-scoped client-home numbers and lists from the title rows and my_findings
 * already loaded for `/`. No extra SQL. Upcoming, revenue, and platform
 * placements are intentionally absent.
 */
export function clientHomeSnapshot({
  titles,
  findings,
  orgId,
  now,
  bound,
}: {
  titles: ClientHomeTitle[];
  findings: ClientHomeFinding[];
  orgId: string;
  now: Date;
  bound: number;
}): ClientHomeSnapshot {
  const newestFirst = [...titles].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return {
    catalog: titles.length,
    catalogIsPartial: titles.length >= bound,
    needsAttention: new Set(
      findings.filter((f) => f.org_id === orgId).map((f) => f.entity_id),
    ).size,
    live: titles.filter((t) => t.status === "live").length,
    drafts: newestFirst
      .filter((t) => t.status === "draft")
      .slice(0, DASHBOARD_HOME_DRAFTS)
      .map((t) => ({ id: t.id, title: t.title })),
    justIn: newestFirst
      .filter((t) => isJustIn(t.created_at, now))
      .slice(0, DASHBOARD_HOME_JUST_IN)
      .map((t) => ({ id: t.id, title: t.title, created_at: t.created_at })),
  };
}
