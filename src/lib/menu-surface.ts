// Shared menu surface chrome. Desktop profile/user-menu and the thread ···
// both instance this register. Do not fork a THREAD_POPOVER_* lookalike.

export const MENU_SURFACE_CONTENT_CLASS =
  "min-w-[17.5rem] rounded-[var(--radius)] p-[var(--space-2)]";

export const MENU_SURFACE_ITEM_CLASS =
  "rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)] t-body-sm text-ink-2";

export const MENU_SURFACE_SEPARATOR_CLASS = "my-[var(--space-2)]";

// Thin danger tint on the same item — not a second surface or a heavier mark.
export const MENU_SURFACE_ITEM_DANGER_CLASS =
  "text-[#c4564a] data-[highlighted]:text-[#c4564a]";
