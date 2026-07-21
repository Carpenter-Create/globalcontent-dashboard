import type { Database } from "@/lib/supabase/database.types";

export type TitleStatus = Database["public"]["Enums"]["title_status"];

// Client-facing title vocabulary (founder-decided): in_review → "In review",
// in_delivery → "Submitted". "Live" is derived (≥1 delivery live), not an enum value.
export const TITLE_STATUS_LABELS: Record<TitleStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In review",
  in_delivery: "Submitted",
  live: "Live",
  takedown_requested: "Takedown requested",
  taken_down: "Taken down",
};

// The status a client sees. Once a title is live on ≥1 platform, show the derived
// "Live · N of M platforms" rollup on top of its lifecycle state.
export function titleDisplayStatus(status: TitleStatus, liveCount: number, totalCount: number): string {
  if (liveCount > 0) return `Live · ${liveCount} of ${totalCount} platforms`;
  return TITLE_STATUS_LABELS[status];
}

// GC-facing status wording (assembly line: review → approved/ready → delivering → live).
// Clients see TITLE_STATUS_LABELS; GC's operator view is clearer.
export const GC_TITLE_STATUS_LABELS: Partial<Record<TitleStatus, string>> = {
  in_review: "Needs review",
  in_delivery: "Approved · ready to deliver",
  live: "Live",
  takedown_requested: "Takedown requested",
  taken_down: "Taken down",
};
export const gcTitleStatusLabel = (s: TitleStatus): string =>
  GC_TITLE_STATUS_LABELS[s] ?? TITLE_STATUS_LABELS[s];
