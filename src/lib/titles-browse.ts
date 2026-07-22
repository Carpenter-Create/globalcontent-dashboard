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

/** Featured title: soonest upcoming release, else the most-recent live title, else the most recent. */
export function spotlightTitle(rows: BrowseTitle[], now: Date): BrowseTitle | null {
  if (rows.length === 0) return null;
  const upcoming = rows
    .filter((r) => isUpcoming(r.release_date, now))
    .sort((a, b) => (a.release_date! < b.release_date! ? -1 : 1));
  if (upcoming.length) return upcoming[0];
  const byRecency = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return byRecency.find((r) => r.live > 0) ?? byRecency[0];
}
