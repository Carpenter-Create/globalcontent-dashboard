// Findings copy + labels (§19 attention queue). Copy lives in lib/, not JSX.

export const FINDING_SEVERITY_LABEL: Record<"high" | "low", string> = {
  high: "Required",
  low: "Recommended",
};

// Catalog Health = the single client-side findings/health overview.
export const CATALOG_HEALTH_SUBTITLE = "What needs your attention across your catalog.";
export const CATALOG_HEALTH_EMPTY = "Nothing needs your attention right now.";

// Home Do next lists finding + draft rows; Catalog Health owns the full queue.
export const DASHBOARD_ATTENTION_CLEAR = "Your catalog is in good standing.";
export function dashboardAttentionSummary(titleCount: number): string {
  return titleCount === 1
    ? "1 title needs your attention."
    : `${titleCount} titles need your attention.`;
}
