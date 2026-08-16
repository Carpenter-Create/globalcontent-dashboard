import { TITLE_STATUS_LABELS, type TitleStatus } from "@/lib/titles";

// Client `/titles` catalog copy and list helpers. Lives in lib/, not JSX.
// One list, every org-owned title, every existing title.status. Do not invent
// statuses, rails, or a second catalog.

export const TITLES_CATALOG = {
  title: "Titles",
  addTitle: "Add Title",
  empty: "No titles yet.",
  emptyCanOperate: "Add your first title to begin building your catalog.",
  emptyReadOnly: "Titles will appear here once they're added.",
  searchMiss: (q: string) => `No titles match “${q}”.`,
  searchMissHint: "Try a different search.",
} as const;

/** Existing title.status values, in lifecycle order. Not a new vocabulary. */
export const CATALOG_LIFECYCLE_STATES = [
  "draft",
  "submitted",
  "in_review",
  "in_delivery",
  "live",
  "takedown_requested",
  "taken_down",
] as const satisfies readonly TitleStatus[];

export function catalogStatusMark(status: TitleStatus): string {
  return TITLE_STATUS_LABELS[status];
}

/** Real promotional art only. Poster first (portrait); else banner; else nothing. */
export function catalogStillSrc(
  bannerUrl: string | null | undefined,
  posterUrl: string | null | undefined,
): string | null {
  return posterUrl || bannerUrl || null;
}
