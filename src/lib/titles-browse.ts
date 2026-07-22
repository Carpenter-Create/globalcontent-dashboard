import { isUpcoming } from "@/lib/releases";
import type { TitleStatus } from "@/lib/titles";

// Pure helpers for the streaming-browse Titles surface (Visual register). No React,
// no client state — the page filters/groups server-side from the URL, so these are
// unit-tested in isolation.

export type BrowseTitle = {
  id: string;
  title: string;
  status: TitleStatus;
  created_at: string;
  release_date: string | null;
  live: number;
  total: number;
  posterUrl: string | null;
  bannerUrl: string | null;
};

export type Rail<T> = { key: string; label: string; rows: T[] };

const RECENT_COUNT = 12;

/** Case-insensitive substring match on title. Empty/whitespace query → all rows. */
export function filterTitles<T extends { title: string }>(rows: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => r.title.toLowerCase().includes(needle));
}

/**
 * Group titles into streaming-style rails, emitted in a fixed priority order and only
 * when non-empty. A title may appear in more than one rail (e.g. "Recently added" +
 * "Live"), matching the streaming idiom. Within a rail, order is recency-desc except
 * "Upcoming", which is soonest-first.
 */
export function groupIntoRails(rows: BrowseTitle[], now: Date): Rail<BrowseTitle>[] {
  const byRecency = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const rails: Rail<BrowseTitle>[] = [];

  const recent = byRecency.slice(0, RECENT_COUNT);
  if (recent.length) rails.push({ key: "recent", label: "Recently added", rows: recent });

  const live = byRecency.filter((r) => r.live > 0);
  if (live.length) rails.push({ key: "live", label: "Live", rows: live });

  const upcoming = byRecency
    .filter((r) => isUpcoming(r.release_date, now))
    .sort((a, b) => (a.release_date! < b.release_date! ? -1 : 1));
  if (upcoming.length) rails.push({ key: "upcoming", label: "Upcoming", rows: upcoming });

  const inReview = byRecency.filter((r) => r.status === "in_review");
  if (inReview.length) rails.push({ key: "in_review", label: "In review", rows: inReview });

  const inProgress = byRecency.filter(
    (r) =>
      r.live === 0 &&
      (r.status === "draft" || r.status === "submitted" || r.status === "in_delivery"),
  );
  if (inProgress.length) rails.push({ key: "in_progress", label: "In progress", rows: inProgress });

  return rails;
}

// Spotlight = the hero pick: soonest UPCOMING release, else the most-recently-added title.
// Within the chosen pool, prefer one that HAS a banner (so the hero actually shows), but
// still return a candidate otherwise — the page requires a banner to render the hero, so
// we never show a weak no-image placeholder. Whether the pick is upcoming decides the
// "Next up" vs "Featured" kicker (see isUpcoming in the page).
export function spotlightTitle(rows: BrowseTitle[], now: Date): BrowseTitle | null {
  const upcoming = rows
    .filter((r) => isUpcoming(r.release_date, now))
    .sort((a, b) => (a.release_date! < b.release_date! ? -1 : 1));
  const pool = upcoming.length
    ? upcoming
    : [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return pool.find((r) => r.bannerUrl) ?? pool[0] ?? null;
}

export type CatalogStatusFilter = "all" | "live" | "upcoming" | "in_review" | "in_progress";

export const CATALOG_STATUS_FILTERS: { key: CatalogStatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "upcoming", label: "Upcoming" },
  { key: "in_review", label: "In review" },
  { key: "in_progress", label: "In progress" },
];

export function parseStatusFilter(v: string | undefined): CatalogStatusFilter {
  return CATALOG_STATUS_FILTERS.some((f) => f.key === v) ? (v as CatalogStatusFilter) : "all";
}

/** Filter by the same categories the rails use. 'all' passes everything through. */
export function filterByStatus(
  rows: BrowseTitle[],
  status: CatalogStatusFilter,
  now: Date,
): BrowseTitle[] {
  switch (status) {
    case "live":
      return rows.filter((r) => r.live > 0);
    case "upcoming":
      return rows.filter((r) => isUpcoming(r.release_date, now));
    case "in_review":
      return rows.filter((r) => r.status === "in_review");
    case "in_progress":
      return rows.filter(
        (r) =>
          r.live === 0 &&
          (r.status === "draft" || r.status === "submitted" || r.status === "in_delivery"),
      );
    default:
      return rows;
  }
}
