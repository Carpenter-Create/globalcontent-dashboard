// Locked house sheet primitives. Classes live here so account, nav, and the
// thread popover consume one scale — do not restyle per page.
// Figma: Close/44 543:562, Text action 543:563, Identity 543:565, Group
// 543:570, App sheet 543:576, Thread Popover 544:592.

export const CLOSE_44_CLASS =
  "flex size-[44px] min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-3";

export const TEXT_ACTION_CLASS = "t-body-sm font-normal text-accent";

export const IDENTITY_BLOCK_CLASS = "flex flex-col items-start gap-[var(--space-4)]";

export const IDENTITY_AVATAR_CLASS =
  "flex size-12 shrink-0 items-center justify-center rounded-full bg-surface-muted t-body font-normal text-ink-2";

export const IDENTITY_NAME_CLASS = "t-body font-normal text-ink";

export const IDENTITY_EMAIL_CLASS = "t-body-sm font-normal text-ink-3";

export const SHEET_GROUP_CLASS = "flex flex-col items-start gap-[var(--space-6)]";

export const SHEET_GROUP_LABEL_CLASS =
  "text-[length:var(--text-xs)] font-normal uppercase tracking-[0.08em] text-ink-2";

export const SHEET_GROUP_ITEM_CLASS =
  "flex items-center text-[length:var(--text-base)] font-normal leading-5 text-ink";

export const APP_SHEET_SURFACE_CLASS =
  "flex flex-col gap-[var(--space-6)] rounded-t-[16px] bg-surface px-[var(--space-4)] pb-[var(--space-12)] pt-[var(--space-6)]";

export const APP_SHEET_HEAD_CLASS = "flex h-[44px] shrink-0 items-center";

export const APP_SHEET_HAIRLINE_CLASS = "h-px w-full bg-hairline";

export const APP_SHEET_SCRIM_CLASS = "absolute inset-0 bg-ink/24";

export const THREAD_POPOVER_CONTENT_CLASS =
  "flex min-w-0 flex-col gap-[var(--space-2)] rounded-[12px] border border-hairline bg-surface p-[var(--space-4)] shadow-none";

export const THREAD_POPOVER_ITEM_CLASS =
  "gap-[var(--space-2)] p-0 t-body font-normal text-ink data-[highlighted]:bg-surface-muted data-[highlighted]:text-ink";

export const THREAD_POPOVER_DELETE_CLASS =
  "gap-[var(--space-2)] p-0 t-body font-normal text-[#c4564a] data-[highlighted]:bg-surface-muted data-[highlighted]:text-[#c4564a]";

export const THREAD_POPOVER_ICON_CLASS = "size-4 shrink-0 text-ink-3";

export const THREAD_POPOVER_DELETE_ICON_CLASS = "size-4 shrink-0 text-[#c4564a]";
