import { isJustIn } from "@/lib/releases";
import { TITLE_STATUS_LABELS, type TitleStatus } from "@/lib/titles";
import { TITLES_CATALOG } from "@/lib/titles-catalog";

// Client `/` portfolio copy and snapshot derivation. Lives in lib/, not JSX.
// Identity on `/` is the real org name only — no status, role, or term line.
// Do not invent Access, upcoming, revenue, or a "stuck too long" metric.
// Empty-catalog CTA is the existing Titles Add Title action — do not invent a
// second control. Artwork-missing copy is a finding message, never invented here.

export const DASHBOARD_HOME = {
  justIn: "Recent",
  justInEmpty: "No titles added recently.",
  catalogEmpty: "The catalog is empty.",
  addTitle: TITLES_CATALOG.addTitle,
  addTitleHref: "/titles",
  catalogHealthCta: "Catalog Health",
  catalog: "Catalog",
  needsAttention: "Needs attention",
  live: "Live",
  doNext: "Do next",
} as const;

export const DASHBOARD_HOME_DO_NEXT = 5;
export const DASHBOARD_HOME_DRAFTS = DASHBOARD_HOME_DO_NEXT;
export const DASHBOARD_HOME_JUST_IN = 5;

const JUST_IN_DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export type ClientHomeTitle = {
  id: string;
  title: string;
  status: string;
  created_at: string;
};

// my_findings already returns message + severity. Home reuses that reason copy —
// never invents "Artwork missing" / "Metadata incomplete".
export type ClientHomeFinding = {
  org_id: string;
  entity_id: string;
  message?: string | null;
  severity?: string | null;
  created_at?: string | null;
};

export type ClientHomeDoNextItem = {
  id: string;
  title: string;
  reason: string | null;
  status: string;
};

export type ClientHomeJustInItem = {
  id: string;
  title: string;
  status: string;
  created_at: string;
};

export type ClientHomeSnapshot = {
  catalog: number;
  catalogIsPartial: boolean;
  needsAttention: number;
  live: number;
  doNext: ClientHomeDoNextItem[];
  justIn: ClientHomeJustInItem[];
};

/**
 * Visible floor when the title read hit the bound. `500+` means at least 500,
 * not a claimed total and not a trend. Live uses the same helper because it
 * is counted from that same bounded array.
 */
export function dashboardCatalogValue(count: number, isPartial: boolean): string {
  return isPartial ? `${count}+` : String(count);
}

export function dashboardJustInDate(iso: string): string {
  return JUST_IN_DATE.format(new Date(iso));
}

export function dashboardTitleStatusLabel(status: string): string | null {
  return Object.hasOwn(TITLE_STATUS_LABELS, status)
    ? TITLE_STATUS_LABELS[status as TitleStatus]
    : null;
}

function findingReason(items: ClientHomeFinding[]): string | null {
  const ranked = [...items].sort((a, b) => {
    const aHigh = a.severity === "high" ? 0 : 1;
    const bHigh = b.severity === "high" ? 0 : 1;
    return aHigh - bHigh;
  });
  for (const f of ranked) {
    const message = f.message?.trim();
    if (message) return message;
  }
  return null;
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
  const titleById = new Map(newestFirst.map((t) => [t.id, t]));
  const orgFindings = findings.filter((f) => f.org_id === orgId);

  const findingsByTitle = new Map<string, ClientHomeFinding[]>();
  for (const f of orgFindings) {
    const list = findingsByTitle.get(f.entity_id) ?? [];
    list.push(f);
    findingsByTitle.set(f.entity_id, list);
  }

  const findingRows: ClientHomeDoNextItem[] = [...findingsByTitle.entries()]
    .flatMap(([entityId, items]) => {
      const title = titleById.get(entityId);
      if (!title) return [];
      return [
        {
          id: title.id,
          title: title.title,
          reason: findingReason(items),
          status: title.status,
        },
      ];
    })
    .sort((a, b) => {
      const aCreated = titleById.get(a.id)?.created_at ?? "";
      const bCreated = titleById.get(b.id)?.created_at ?? "";
      return aCreated < bCreated ? 1 : -1;
    });

  const seen = new Set(findingRows.map((row) => row.id));
  const draftRows: ClientHomeDoNextItem[] = newestFirst
    .filter((t) => t.status === "draft" && !seen.has(t.id))
    .map((t) => ({
      id: t.id,
      title: t.title,
      reason: null,
      status: t.status,
    }));

  const doNext = [...findingRows, ...draftRows].slice(0, DASHBOARD_HOME_DO_NEXT);

  return {
    catalog: titles.length,
    catalogIsPartial: titles.length >= bound,
    needsAttention: new Set(orgFindings.map((f) => f.entity_id)).size,
    live: titles.filter((t) => t.status === "live").length,
    doNext,
    justIn: newestFirst
      .filter((t) => isJustIn(t.created_at, now))
      .slice(0, DASHBOARD_HOME_JUST_IN)
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        created_at: t.created_at,
      })),
  };
}
