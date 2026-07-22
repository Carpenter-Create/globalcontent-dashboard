// Release-date model + pipeline logic (spec: docs/superpowers/specs/
// 2026-07-21-release-dates-and-dashboard-tiles-design.md).
//
// The forward-looking release_date is GC-owned (distribution is GC's); the client
// only enters original_release_date, and only for a re-release. The Dashboard's
// pipeline reads release_date; the "original" shown in metadata falls back to it.

export type ReleaseType = "new_release" | "re_release";

export type ReleaseFields = {
  release_type: ReleaseType;
  original_release_date: string | null; // ISO date (YYYY-MM-DD); re-release only
  release_date: string | null; // ISO date; GC-owned go-to-market date
};

export const RELEASE_TYPE_LABEL: Record<ReleaseType, string> = {
  new_release: "New release",
  re_release: "Re-release",
};

// Pipeline windows (adjustable). "New" = released within this many days; "Just in"
// = added to the catalog within this many days (independent of release date).
export const RELEASE_NEW_WINDOW_DAYS = 30;
export const JUST_IN_WINDOW_DAYS = 30;

// The date the Dashboard treats as the title's release — always the GC-owned one.
export function effectiveReleaseDate(t: Pick<ReleaseFields, "release_date">): string | null {
  return t.release_date;
}

// Authoritative original date for display: the historical original if entered,
// otherwise the release date (a new release's original IS its release date).
export function displayOriginalDate(
  t: Pick<ReleaseFields, "original_release_date" | "release_date">,
): string | null {
  return t.original_release_date ?? t.release_date;
}

// --- pipeline predicates (pure; take `now` so they're deterministic in tests) ---

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

// Upcoming: release date is in the future (string compare on YYYY-MM-DD is chronological).
export function isUpcoming(releaseDate: string | null, now: Date): boolean {
  if (!releaseDate) return false;
  return releaseDate > toDateStr(now);
}

// New release: release date within the trailing window (today back N days), inclusive.
export function isNewRelease(
  releaseDate: string | null,
  now: Date,
  windowDays: number = RELEASE_NEW_WINDOW_DAYS,
): boolean {
  if (!releaseDate) return false;
  const today = toDateStr(now);
  const from = toDateStr(addDays(now, -windowDays));
  return releaseDate <= today && releaseDate >= from;
}

// Just in: added to the catalog within the trailing window.
export function isJustIn(
  createdAt: string,
  now: Date,
  windowDays: number = JUST_IN_WINDOW_DAYS,
): boolean {
  return new Date(createdAt) >= addDays(now, -windowDays);
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export function formatReleaseDate(d: string | null): string {
  if (!d) return "—";
  // Parse as a plain calendar date (avoid TZ shifting a date-only value).
  return DATE_FMT.format(new Date(`${d}T00:00:00`));
}
