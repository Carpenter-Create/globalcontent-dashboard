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
