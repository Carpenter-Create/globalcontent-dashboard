// Locked house sheet primitives. Classes live here so account and nav
// consume one scale — do not restyle per page.
// Figma: Close/44 543:562, Text action 543:563, Identity 543:565, Group
// 543:570, App sheet 543:576.
// Thread ··· chrome lives on the shared menu surface, not here.

export const CLOSE_44_CLASS =
  "flex size-[44px] min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-3";

export const TEXT_ACTION_CLASS = "t-body-sm font-normal text-accent";

// House empty line — same 15 Regular as catalog / titles empties.
// Do not invent product copy in the primitive.
export const HOUSE_EMPTY_CLASS = "t-body text-ink-2";

// 544:561 row chevron — 16 / 1.33, tertiary. Same stroke as Close/44.
export const SHEET_GROUP_CHEVRON_CLASS = "size-4 shrink-0 text-ink-3";

export const IDENTITY_BLOCK_CLASS = "flex min-w-0 items-center gap-[var(--space-4)]";

export const IDENTITY_AVATAR_CLASS =
  "flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-muted t-body font-normal text-ink-2";

export const IDENTITY_NAME_CLASS = "t-body font-normal text-ink";

export const IDENTITY_EMAIL_CLASS = "t-body-sm font-normal text-ink-3";

export const SHEET_GROUP_CLASS = "flex flex-col items-start gap-[var(--space-6)]";

export const SHEET_GROUP_LABEL_CLASS =
  "text-[length:var(--text-xs)] font-normal uppercase tracking-[0.08em] text-ink-2";

export const SHEET_GROUP_ITEM_CLASS =
  "flex w-full items-center justify-between text-[length:var(--text-base)] font-normal leading-5 text-ink";

// App-sheet motion — one duration/easing for the nav hamburger and the
// account instance. Rise from the bottom, ease-out, no bounce. Reduced
// motion skips the slide. Do not restyle per page.
export const APP_SHEET_MOTION_DURATION_MS = 320;
export const APP_SHEET_MOTION_EASING = "ease-out";
export const APP_SHEET_RISE_CLASS = "app-sheet-rise";
export const APP_SHEET_SCRIM_FADE_CLASS = "app-sheet-scrim-fade";

export const APP_SHEET_SURFACE_CLASS =
  "flex flex-col gap-[var(--space-6)] rounded-t-[16px] bg-surface px-[var(--space-4)] pb-[var(--space-12)] pt-[var(--space-6)] app-sheet-rise";

export const APP_SHEET_HEAD_CLASS = "flex h-[44px] shrink-0 items-center";

export const APP_SHEET_HAIRLINE_CLASS = "h-px w-full bg-hairline";

export const APP_SHEET_SCRIM_CLASS = "absolute inset-0 bg-ink/24 app-sheet-scrim-fade";

// Thread ··· item glyphs only — surface chrome is MenuSurface.
export const THREAD_POPOVER_ICON_CLASS = "size-4 shrink-0 text-ink-3";

export const THREAD_POPOVER_DELETE_ICON_CLASS = "size-4 shrink-0 text-[#c4564a]";
