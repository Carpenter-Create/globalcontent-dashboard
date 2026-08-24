// /settings copy and doors. Copy lives here, not in JSX.
// One page, two hashes. Profile persist is the existing /account
// name + avatar path — do not add Storage, SQL, RLS, or auth.
// Agreements is a house empty. Do not invent a listing, download,
// Phone, Job, or Company on this page. Appearance stays in-menu.

import { USER_MENU } from "@/lib/user-menu";

export const SETTINGS = {
  href: "/settings",
  profile: USER_MENU.profile,
  profileHash: "profile",
  profileHref: USER_MENU.profileHref,
  agreements: USER_MENU.agreements,
  agreementsHash: "agreements",
  agreementsHref: USER_MENU.agreementsHref,
  agreementsEmpty: "No agreements on this account.",
  dashboard: "Dashboard",
  dashboardHref: "/",
} as const;

export const SETTINGS_ABSENT = [
  "User Profile",
  "Company Profile",
  "Phone",
  "Job",
  "Company",
  "Used to sign in.",
  "Name and email on this account.",
] as const;

export type SettingsSection = "profile" | "agreements";

export const SETTINGS_LOCAL_NAV = [
  { kind: "dashboard" as const, label: SETTINGS.dashboard, href: SETTINGS.dashboardHref },
  { kind: "profile" as const, label: SETTINGS.profile, href: SETTINGS.profileHref },
  { kind: "agreements" as const, label: SETTINGS.agreements, href: SETTINGS.agreementsHref },
] as const;

export function settingsHref(hash: string): `/settings#${string}` {
  return `/settings#${hash}`;
}

/** Empty or unknown hash opens Profile. Only #agreements is the other door. */
export function settingsSection(hash: string | null | undefined): SettingsSection {
  const value = (hash ?? "").replace(/^#/, "");
  return value === SETTINGS.agreementsHash ? "agreements" : "profile";
}

export function settingsPath(href: string): string {
  const hashAt = href.indexOf("#");
  return hashAt === -1 ? href : href.slice(0, hashAt);
}
