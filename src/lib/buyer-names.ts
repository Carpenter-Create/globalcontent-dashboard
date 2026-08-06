// ILIKE escaping for the screener share-link collision check (create_screener_link, Task 4/5).
//
// The RPC matches an existing live link with
// `lower(recipient_name) is not distinct from lower(nullif(btrim(p_recipient_name), ''))`
// (20260806000300, unchanged from 20260806000200 — only the author partition around it was
// removed) — and replaces it, silently, by design, from the DB's point of view. The app-side
// collision check (createBuyerScreenerLink, actions.ts) uses a DB-side `.ilike()` against that
// same recipient_name column rather than fetching every candidate and comparing in TS — which
// is why the only thing this file still needs to own is making that ILIKE pattern behave like
// a literal string, not a wildcard search.
//
// (Fix round 3, item 7: this file used to also export normaliseBuyerName/buyerNameMatches, a
// TS-side "same buyer" comparison from before the collision check moved to DB-side ilike. They
// had no production caller left — only their own tests — so they were deleted rather than kept
// as an unused second definition of "the same buyer" alongside the DB's real one below.)

/**
 * Postgres ILIKE treats `%` (any run of characters) and `_` (any single character) as
 * wildcards, with `\` as the escape character. A buyer literally named "50% Films" or
 * "A_B Studios" would otherwise turn into a wildcard pattern and the collision check could
 * match — or fail to match — the wrong rows. Escaping makes ILIKE treat the value as a
 * literal (still case-insensitive) string.
 *
 * `*` needs the same treatment for a different reason: PostgREST itself (not Postgres) maps
 * an unescaped `*` to `%` in a `like`/`ilike` filter value before it ever reaches the
 * database — a documented convenience so a URL doesn't have to percent-encode `%25`. A buyer
 * named "A*B" would otherwise act as "A" + any run of characters + "B" in the collision check
 * this escapes for (createBuyerScreenerLink's `.ilike()` call). `\*` is how PostgREST spells a
 * literal asterisk, so the escape output must produce that, not a bare `*`.
 */
export function escapeIlikePattern(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*");
}
