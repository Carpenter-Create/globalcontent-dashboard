// Catalog-activity chart logic (spec: docs/superpowers/specs/
// 2026-07-22-dashboard-charted-hero-design.md).
//
// Pure, deterministic derivation of the Dashboard hero's series: cumulative catalog
// size over time, from title.created_at timestamps. REAL data — never a placeholder
// curve (brand rule: never invent stats). Kept in lib/ (not the component) so it's
// unit-testable and the render stays presentational.

export const DAY_MS = 86_400_000;

export type CatalogRange = "30d" | "90d" | "1y" | "all";

export const CATALOG_RANGES: { key: CatalogRange; label: string; days: number }[] = [
  { key: "30d", label: "30D", days: 30 },
  { key: "90d", label: "90D", days: 90 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "all", label: "All", days: Infinity },
];

export const RANGE_WORD: Record<CatalogRange, string> = {
  "30d": "in the last 30 days",
  "90d": "in the last 90 days",
  "1y": "in the last year",
  all: "all time",
};

export type CatalogPoint = { t: number; c: number };

export type CatalogSeries = {
  /** Cumulative points across the window, anchored at the window start and at `now`. */
  points: CatalogPoint[];
  /** Window start (ms). */
  start: number;
  /** Total catalog size (all titles). */
  total: number;
  /** Titles added within the window. */
  added: number;
  /** Peak cumulative value in the window (>= 1 for scaling). */
  yMax: number;
};

/**
 * Build the cumulative-catalog series for a window.
 *
 * `createdAt` MUST be sorted ascending (ms since epoch). Cumulative count reflects
 * the running catalog *size*: at the window start it already includes titles that
 * predate the window, then steps up for each title added inside it, and is anchored
 * to `nowMs` so the playhead sits on the current total. Returns null for an empty
 * catalog (the UI shows an honest empty state rather than a faked line).
 */
export function cumulativeCatalogSeries(
  createdAt: number[],
  nowMs: number,
  days: number,
): CatalogSeries | null {
  const total = createdAt.length;
  if (total === 0) return null;

  const earliest = createdAt[0];
  // "All" opens just before the first title so the line rises from 0 and the
  // window's "added" equals the whole catalog. Fixed windows open at now − days.
  const start = days === Infinity ? earliest - 1 : Math.max(nowMs - days * DAY_MS, 0);

  // Cumulative catalog size AT the window start (titles already in the catalog).
  let baseCount = 0;
  for (const t of createdAt) {
    if (t <= start) baseCount++;
    else break;
  }
  const inWindow = createdAt.filter((t) => t > start && t <= nowMs);

  const points: CatalogPoint[] = [{ t: start, c: baseCount }];
  let running = baseCount;
  for (const t of inWindow) {
    running++;
    points.push({ t, c: running });
  }
  // Anchor to "now" so the line ends at the current total (the playhead).
  points.push({ t: nowMs, c: running });

  return { points, start, total, added: inWindow.length, yMax: Math.max(running, 1) };
}
