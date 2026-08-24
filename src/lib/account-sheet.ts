// Mobile 544:561 / 537:557 and desktop 586:768 / 586:814 Identity menu.
// Copy lives here, not in JSX.
// Identity is avatar + name + email from the same values /settings#profile
// would show. Always render both fields. No dashes, no invented
// local-part name. Items after the Identity hairline are
// USER_MENU_ACTIONS — the same list on mobile and desktop. Appearance
// opens the second face. Destinations use existing routes only — not
// /account/appearance. Company stays off this menu. Log out, Legal, and
// the version footer are pinned, not in the scroll.
// Mobile chrome is the 90% sheet. Desktop chrome is the hug-height
// dropdown under the avatar. Labels stay one source.

import { TEXT_ACTION_CLASS } from "@/lib/house-sheet";
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

// 544:561 / 537:557 — sides 24, bottom 32. 32 clear under the 4px half-bar
// (padT 36 = 4+32) so the bar does not eat the top air. 90% viewport.
// Identity 48 + Close/44 one row. Desktop 586:768 does not use this surface.
export const ACCOUNT_SHEET_HOST_CLASS =
  "fixed inset-0 z-50 flex h-dvh w-full flex-col justify-end";

export const ACCOUNT_SHEET_SURFACE_CLASS =
  "account-sheet-surface relative z-10 flex h-[90dvh] w-full flex-col gap-[var(--space-6)] rounded-t-[16px] bg-surface px-[var(--space-6)] pb-[var(--space-8)] pt-[calc(4px+var(--space-8))] app-sheet-rise";

export const ACCOUNT_SHEET_HEAD_CLASS =
  "flex min-h-12 w-full shrink-0 items-center justify-between";

export const ACCOUNT_SHEET_SCROLL_CLASS = "flex min-h-0 flex-1 flex-col overflow-y-auto";

export const ACCOUNT_SHEET_LOGOUT_CLASS =
  "flex items-center gap-[var(--space-2)] text-[length:var(--text-base)] font-normal leading-5 text-accent";

// Footer on both menus — 13 Regular / 16. Version tertiary. Legal Sporty Blue.
export const ACCOUNT_SHEET_FOOTER_CLASS =
  "flex h-4 w-full shrink-0 items-center justify-between";

export const ACCOUNT_SHEET_VERSION_CLASS = "t-body-sm font-normal leading-4 text-ink-3";

export const ACCOUNT_SHEET_LEGAL_CLASS = `${TEXT_ACTION_CLASS} leading-4`;

// 586:768 / 586:814 — 264 hug under the avatar. Not a 90% sheet.
// Not a tall right takeover. Pad 16. padT 28 (4 bar + 24 air). Gap 16.
// Close killed — dismiss on outside click / avatar. Stacked identity.
// No ellipsis. Half-bar is 132×4 = 50% of 264.
export const ACCOUNT_MENU_DROPDOWN_HOST_CLASS = "fixed inset-0 z-50";

export const ACCOUNT_MENU_DROPDOWN_DISMISS_CLASS = "absolute inset-0";

export const ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS =
  "absolute top-[calc(var(--header-height)+var(--space-2))] right-[var(--content-inset)] z-10 flex h-auto w-[264px] flex-col gap-[var(--space-4)] overflow-hidden rounded-[12px] border border-hairline bg-surface px-[var(--space-4)] pb-[var(--space-4)] pt-[calc(4px+var(--space-6))]";

export const ACCOUNT_MENU_DROPDOWN_HEAD_CLASS = "flex w-full flex-col items-start";

export const ACCOUNT_MENU_DROPDOWN_IDENTITY_CLASS =
  "flex min-w-0 w-full flex-col items-start gap-[var(--space-2)] break-words";

export const ACCOUNT_MENU_DROPDOWN_GROUP_CLASS =
  "flex w-full flex-col items-start gap-[var(--space-4)]";

export const ACCOUNT_MENU_DROPDOWN_SCROLL_CLASS = "flex w-full flex-col";

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
  const hashAt = href.indexOf("#");
  const dest = hashAt === -1 ? href : href.slice(0, hashAt);
  return pathname === dest;
}
