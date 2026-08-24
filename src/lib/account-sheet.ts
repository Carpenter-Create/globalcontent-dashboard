// Mobile 544:561 / 547:612 account sheet. Copy lives here, not in JSX.
// Identity is avatar + name + email from the same values /account would
// show. Always render both fields. No dashes, no invented local-part name.
// Items after the hairline are USER_MENU_ACTIONS — the same list as the
// desktop menu. Destinations use existing routes only.

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
] as const;

// One source, both instances. Sheet chrome may differ; labels may not.
export const ACCOUNT_SHEET_ITEMS = USER_MENU_ACTIONS;

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
