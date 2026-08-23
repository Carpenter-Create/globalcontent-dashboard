// Mobile 537:557 account overlay. Copy lives here, not in JSX.
// Identity is name + email from /account — dashes if empty. Never invent a
// name from the email local-part. Destinations use existing routes only.

import { USER_MENU, userMenuAvatarInitial, userMenuName } from "@/lib/user-menu";

export const ACCOUNT_OVERLAY = {
  close: "Close account",
  sheet: "Account",
  manage: "Manage account",
  manageHref: "/account",
  group: "ACCOUNT",
  empty: "—",
  userProfile: "User Profile",
  companyProfile: "Company Profile",
  agreements: "Agreements",
} as const;

export const ACCOUNT_OVERLAY_ABSENT = [
  "Dashboard",
  "Titles",
  "Deliveries",
  "Catalog Health",
  "Ask Globee",
  "Queue",
  "Appearance",
  "Log out",
  "credits",
  "Buy",
] as const;

export type AccountOverlayItem = {
  kind: "userProfile" | "companyProfile" | "agreements";
  label: string;
  href: string | null;
};

// User Profile is /account (same page Manage account opens). Company Profile
// has no route in this repo. Agreements is the existing page.
export const ACCOUNT_OVERLAY_ITEMS: readonly AccountOverlayItem[] = [
  { kind: "userProfile", label: ACCOUNT_OVERLAY.userProfile, href: ACCOUNT_OVERLAY.manageHref },
  { kind: "companyProfile", label: ACCOUNT_OVERLAY.companyProfile, href: null },
  { kind: "agreements", label: ACCOUNT_OVERLAY.agreements, href: USER_MENU.agreementsHref },
];

export type AccountOverlayIdentity = {
  avatarInitial: string;
  name: string;
  email: string;
};

function accountOverlayField(value: string | null | undefined): string {
  if (typeof value !== "string") return ACCOUNT_OVERLAY.empty;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : ACCOUNT_OVERLAY.empty;
}

export function accountOverlayIdentity(
  email: string,
  name?: string | null,
): AccountOverlayIdentity {
  return {
    avatarInitial: userMenuAvatarInitial(email),
    name: accountOverlayField(userMenuName(name)),
    email: accountOverlayField(email),
  };
}

export function destinationClickClosesOverlay(pathname: string, href: string): boolean {
  return pathname === href;
}
