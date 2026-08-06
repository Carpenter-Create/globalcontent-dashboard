// Explicit bounds for list reads.
//
// WHY THIS FILE EXISTS. Every list query in the app was unbounded while PostgREST is
// configured with max_rows = 1000 (supabase/config.toml). That combination does not error
// and does not warn — it silently returns the first 1,000 rows. With one title it is
// invisible; at the 20,000-title floor a client with 1,200 films simply cannot see 200 of
// them, and nothing anywhere says so.
//
// Worse, titleArtworkUrls fetches poster AND banner, so it hits the cap at ~500 titles and
// roughly half the artwork disappears — which surfaces months later as "some of my posters
// aren't showing" with no traceable cause.
//
// Phase 1 of the catalog-at-scale spec: make every list read state its bound, and make
// truncation VISIBLE rather than silent. Real pagination is phase 2; this is the honesty
// fix, and it is worth shipping on its own.

/** Page size for catalog-style grids. */
export const LIST_PAGE = 200;

/** Detail-page child collections (a title's grants, assets, findings...). Small by nature. */
export const DETAIL_LIST = 200;

/**
 * Hard ceiling for any read that has not been paginated yet. Deliberately BELOW PostgREST's
 * max_rows (1000): we want our own bound to bite first, so truncation is something we chose
 * and can detect, rather than something the platform did quietly.
 */
export const UNPAGINATED_MAX = 500;

/**
 * Maximum titles in a single vendor export. Well under max_rows so the query cannot be
 * capped, and the route additionally ASSERTS it got everything it asked for — an export is
 * complete or refused, never quietly short. A vendor acting on a truncated catalogue is a
 * worse outcome than a failed download.
 */
export const EXPORT_MAX_TITLES = 500;

/**
 * Supabase `.range()` is inclusive on both ends, so fetching N rows needs `range(0, N-1)`.
 * Getting this off by one silently drops a row, so it lives in one place.
 */
export function rangeFor(limit: number, offset = 0): [number, number] {
  if (limit <= 0) throw new Error("limit must be positive");
  return [offset, offset + limit - 1];
}

/**
 * Fetch `limit + 1` to learn whether more rows exist WITHOUT a second count query — an
 * exact count(*) over an RLS-filtered table is its own performance problem at scale.
 */
export function probeRange(limit: number, offset = 0): [number, number] {
  return rangeFor(limit + 1, offset);
}

/** Split a probe result into the page and whether anything was cut off. */
export function splitProbe<T>(rows: T[] | null, limit: number): { rows: T[]; truncated: boolean } {
  const all = rows ?? [];
  return { rows: all.slice(0, limit), truncated: all.length > limit };
}
