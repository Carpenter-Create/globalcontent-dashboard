// Shared menu surface chrome. Desktop profile/user-menu and the thread ···
// both instance this register. Do not fork a THREAD_POPOVER_* lookalike.
// Optional Identity half-bar (544:561 / 569:639) is OFF unless the instance
// opts in. Thread ··· and Appearance stay off. No dashboard-card bars.

export const MENU_SURFACE_CONTENT_CLASS =
  "min-w-[17.5rem] rounded-[var(--radius)] p-[var(--space-2)]";

export const MENU_SURFACE_ITEM_CLASS =
  "rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)] t-body-sm text-ink-2";

export const MENU_SURFACE_SEPARATOR_CLASS = "my-[var(--space-2)]";

// Thin danger tint on the same item — not a second surface or a heavier mark.
export const MENU_SURFACE_ITEM_DANGER_CLASS =
  "text-[#c4564a] data-[highlighted]:text-[#c4564a]";

// Identity-only chrome. Left-origin, 50% width, 4px, Sporty Blue. No track.
// Flush top of the surface. Token — never a raw hex here.
export const MENU_SURFACE_ACCENT_CLASS =
  "pointer-events-none absolute left-0 top-0 h-[4px] w-1/2 bg-accent";

export const MENU_SURFACE_ACCENT_CLIP_CLASS =
  "pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]";
