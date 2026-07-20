// Findings copy + labels (§19 attention queue). Copy lives in lib/, not JSX.

export const FINDING_SEVERITY_LABEL: Record<"high" | "low", string> = {
  high: "Required",
  low: "Recommended",
};

export const ATTENTION_EMPTY = "Nothing needs your attention right now.";
export const ATTENTION_SUBTITLE = "What needs your attention across your catalog.";
