// Mobile 544:561 / 547:612 and desktop 569:639 Identity panel.
// Copy lives here, not in JSX.
// Identity is avatar + name + email from the same values /account would
// show. Always render both fields. No dashes, no invented local-part name.
// Items after the Identity hairline are USER_MENU_ACTIONS — the same list
// on mobile and desktop. Appearance opens the second face. Destinations
// use existing routes only — not /account/appearance. Company stays off
// this menu. Log out, Legal, and the version footer are pinned, not in
// the scroll.

import { USER_MENU_ACTIONS, userMenuAvatarInitial, userMenuName } from "@/lib/user-menu";

export const ACCOUNT_SHEET = {
  close: "Close account",
  sheet: "Account",
} as const;

export const ACCOUNT_SHEET_ABSENT = [
  "Dashboard",
  "Titles",
  "Deliveries",
  "Catalog Health",
  "Ask Globee",
  "Queue",
  "Manage account",
  "ACCOUNT",
  "credits",
  "Buy",
  "User Profile",
  "Company Profile",
  "Phone",
  "Job",
] as const;

// One source, both instances. Sheet chrome may differ; labels may not.
export const ACCOUNT_SHEET_ITEMS = USER_MENU_ACTIONS;

// 544:561 / 569:639 — pad 24, 90% viewport, Identity 48 + Close/44 one row.
export const ACCOUNT_SHEET_SURFACE_CLASS =
  "account-sheet-surface relative z-10 flex h-[90dvh] w-full flex-col gap-[var(--space-6)] rounded-t-[16px] bg-surface p-[var(--space-6)] app-sheet-rise md:w-[390px]";

export const ACCOUNT_SHEET_HEAD_CLASS =
  "flex min-h-12 w-full shrink-0 items-center justify-between";

export const ACCOUNT_SHEET_SCROLL_CLASS = "flex min-h-0 flex-1 flex-col overflow-y-auto";

export const ACCOUNT_SHEET_LOGOUT_CLASS =
  "flex items-center gap-[var(--space-2)] text-[length:var(--text-base)] font-normal leading-5 text-accent";

export const ACCOUNT_SHEET_FOOTER_CLASS =
  "flex h-4 w-full shrink-0 items-center justify-between";

export const ACCOUNT_SHEET_VERSION_CLASS = "t-body-sm font-normal text-ink-3";

export type AccountSheetIdentity = {
  avatarInitial: string;
  name: string;
  email: string;
};

function accountSheetEmail(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function accountSheetIdentity(
  email: string,
  name?: string | null,
): AccountSheetIdentity {
  return {
    avatarInitial: userMenuAvatarInitial(email),
    name: userMenuName(name) ?? "",
    email: accountSheetEmail(email),
  };
}

export function destinationClickClosesSheet(pathname: string, href: string): boolean {
  return pathname === href;
}
