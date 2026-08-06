// Buyer-name normalisation for screener share links (create_screener_link, Task 4/5).
//
// The RPC matches an existing live link by `lower(btrim(recipient_name)) = lower(btrim(...))`
// and replaces it — silently, by design, from the DB's point of view. The app-side collision
// check in actions.ts has to agree with that rule EXACTLY, or a client could see "no collision"
// in the UI while the RPC quietly kills a URL already emailed to that buyer (or the reverse: a
// false collision warning for a name that wouldn't actually replace anything). Both sides of
// that check live here so there is exactly one definition of "the same buyer".

/** The DB's own rule: trim, then case-fold. Nothing else — no unicode normalisation, no
 * collapsing internal whitespace. Adding more here would let the app and the RPC disagree. */
export function normaliseBuyerName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Postgres ILIKE treats `%` (any run of characters) and `_` (any single character) as
 * wildcards, with `\` as the escape character. A buyer literally named "50% Films" or
 * "A_B Studios" would otherwise turn into a wildcard pattern and the collision check could
 * match — or fail to match — the wrong rows. Escaping makes ILIKE treat the value as a
 * literal (still case-insensitive) string.
 */
export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** True when two buyer names are "the same buyer" under the DB's own matching rule. */
export function buyerNameMatches(a: string, b: string): boolean {
  return normaliseBuyerName(a) === normaliseBuyerName(b);
}
