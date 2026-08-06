// Buyer-name normalisation for screener share links (create_screener_link, Task 4/5).
//
// The RPC matches an existing live link with
// `lower(recipient_name) is not distinct from lower(nullif(btrim(p_recipient_name), ''))`
// (20260806000300, unchanged from 20260806000200 — only the author partition around it was
// removed) — and replaces it, silently, by design, from the DB's point of view.
// Note what that actually trims: only the INCOMING `p_recipient_name`. The stored
// `recipient_name` column is never btrim'd by the SQL itself; it relies on every writer
// having already trimmed before insert (this repo's action does, via `.trim()`). The app-side
// collision check has to agree with the RPC's real behaviour, not an idealised symmetric one,
// or a client could see "no collision" in the UI while the RPC quietly kills a URL already
// emailed to that buyer (or the reverse: a false collision warning for a name that wouldn't
// actually replace anything). Both sides of that check live here so there is exactly one
// definition of "the same buyer".

/** Trim, then case-fold. Nothing else — no unicode normalisation, no collapsing internal
 * whitespace. This is stricter than the RPC's own SQL (which only trims its input parameter,
 * trusting the stored column to already be trimmed) — trimming both sides here is a defensive
 * choice so this comparison doesn't depend on that invariant holding for every historical row,
 * not a claim that the SQL does the same. Adding more than trim+case-fold would risk this and
 * the RPC disagreeing about what counts as the same buyer. */
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
