// Mobile 544:561 / 547:612 account sheet. Copy lives here, not in JSX.
// Identity is avatar + name + email from the same values /account would
// show. Always render both fields. No dashes, no invented local-part name.
// Options after the hairline: Manage account, Company Profile, Agreements,
// then Log out. Destinations use existing routes only.

import { USER_MENU, userMenuAvatarInitial, userMenuName } from "@/lib/user-menu";

export const ACCOUNT_SHEET = {
  close: "Close account",
  sheet: "Account",
  manage: "Manage account",
  manageHref: "/account",
  group: "ACCOUNT",
  companyProfile: "Company Profile",
  agreements: "Agreements",
  logOut: USER_MENU.logOut,
} as const;

export const ACCOUNT_SHEET_ABSENT = [
  "Dashboard",
  "Titles",
  "Deliveries",
  "Catalog Health",
  "Ask Globee",
  "Queue",
  "Appearance",
  "User Profile",
  "credits",
  "Buy",
] as const;

export type AccountSheetItem = {
  kind: "companyProfile" | "agreements";
  label: string;
  href: string | null;
};

// Manage account opens /account (the user-profile door). No User Profile
// row. Company Profile has no route in this repo. Agreements is the
// existing page. Log out is the existing desktop signOut action.
export const ACCOUNT_SHEET_ITEMS: readonly AccountSheetItem[] = [
  { kind: "companyProfile", label: ACCOUNT_SHEET.companyProfile, href: null },
  { kind: "agreements", label: ACCOUNT_SHEET.agreements, href: USER_MENU.agreementsHref },
];

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
