// Pure helpers for URL-driven, server-rendered collections (layout standard). No React,
// no client state — sorting happens on the server from the URL, so these are unit-tested
// in isolation and shared by every DataTable surface.

export type SortDir = "asc" | "desc";
export type Sort = { key: string; dir: SortDir };
export type View = "browse" | "table";

/** Resolve ?sort=&dir= against an allow-list, falling back safely (never trust the URL). */
export function parseSort(
  sortParam: string | undefined,
  dirParam: string | undefined,
  allowed: readonly string[],
  fallback: Sort,
): Sort {
  const key = sortParam && allowed.includes(sortParam) ? sortParam : fallback.key;
  const dir: SortDir = dirParam === "asc" || dirParam === "desc" ? dirParam : fallback.dir;
  return { key, dir };
}

export function parseView(viewParam: string | undefined, fallback: View): View {
  return viewParam === "browse" || viewParam === "table" ? viewParam : fallback;
}

/**
 * Stable sort by a derived value. Nulls always sort last regardless of direction
 * (a missing next-release date should never lead the list). Numbers compare
 * numerically; everything else compares as a locale string.
 */
export function sortRows<T>(
  rows: readonly T[],
  value: (row: T) => string | number | null | undefined,
  dir: SortDir,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows]
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((a, b) => {
      const an = a.v == null || a.v === "";
      const bn = b.v == null || b.v === "";
      if (an && bn) return a.i - b.i;
      if (an) return 1;
      if (bn) return -1;
      if (typeof a.v === "number" && typeof b.v === "number") {
        return a.v === b.v ? a.i - b.i : (a.v - b.v) * sign;
      }
      const c = String(a.v).localeCompare(String(b.v));
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((x) => x.row);
}

/** Direction the header should apply next: toggle when re-clicking the active key. */
export function nextSort(current: Sort, key: string, initialDir: SortDir = "asc"): Sort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: initialDir };
}

/** Build a querystring, dropping empty values and preserving order given. */
export function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
