// Mobile 544:561 / 547:612 account sheet. Copy lives here, not in JSX.
// Identity is name + email only when they exist — no dashes, no invented
// local-part name. Manage account is the user-profile door. Destinations
// use existing routes only.

import { USER_MENU, userMenuAvatarInitial, userMenuName } from "@/lib/user-menu";

export const ACCOUNT_SHEET = {
  close: "Close account",
  sheet: "Account",
  manage: "Manage account",
  manageHref: "/account",
  group: "ACCOUNT",
  companyProfile: "Company Profile",
  agreements: "Agreements",
} as const;

export const ACCOUNT_SHEET_ABSENT = [
  "Dashboard",
  "Titles",
  "Deliveries",
  "Catalog Health",
  "Ask Globee",
  "Queue",
  "Appearance",
  "Log out",
  "User Profile",
  "credits",
  "Buy",
] as const;

export type AccountSheetItem = {
  kind: "companyProfile" | "agreements";
  label: string;
  href: string | null;
};

// Manage account opens /account. No User Profile row. Company Profile has
// no route in this repo. Agreements is the existing page.
export const ACCOUNT_SHEET_ITEMS: readonly AccountSheetItem[] = [
  { kind: "companyProfile", label: ACCOUNT_SHEET.companyProfile, href: null },
  { kind: "agreements", label: ACCOUNT_SHEET.agreements, href: USER_MENU.agreementsHref },
];

export type AccountSheetIdentity = {
  avatarInitial: string;
  name: string | null;
  email: string | null;
};

function presentField(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function accountSheetIdentity(
  email: string,
  name?: string | null,
): AccountSheetIdentity {
  return {
    avatarInitial: userMenuAvatarInitial(email),
    name: userMenuName(name),
    email: presentField(email),
  };
}

export function destinationClickClosesSheet(pathname: string, href: string): boolean {
  return pathname === href;
}
