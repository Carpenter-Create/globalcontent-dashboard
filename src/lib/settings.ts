// /settings copy and doors. Copy lives here, not in JSX.
// One page, two hashes. Profile persist is the existing /account
// name + avatar path — do not add Storage, SQL, RLS, or auth.
// Agreements is a house empty. Do not invent a listing, download,
// Phone, Job, or Company on this page. Appearance stays in-menu.
//
// 600:881 shell — one 220 rail occupies the Access slot on /settings.
// Pad 16. ← Dashboard is 16 chevron + 15 Regular. Active wash follows
// the hash. Not a second column. Header avatar stays. Company off.

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

export type SettingsRailKind = "dashboard" | SettingsSection;

export const SETTINGS_LOCAL_NAV = [
  { kind: "dashboard" as const, label: SETTINGS.dashboard, href: SETTINGS.dashboardHref },
  { kind: "profile" as const, label: SETTINGS.profile, href: SETTINGS.profileHref },
  { kind: "agreements" as const, label: SETTINGS.agreements, href: SETTINGS.agreementsHref },
] as const;

// Rail chrome — 220 slot, pad 16, 8 between rows. Dashboard is 15
// Regular. Do not put Titles, Appearance, Account, Users, or API here.
export const SETTINGS_RAIL_PAD_CLASS = "p-[var(--space-4)]";
export const SETTINGS_RAIL_NAV_CLASS = "flex flex-col gap-[var(--space-2)]";
export const SETTINGS_RAIL_ITEM_CLASS =
  "flex items-center rounded-[var(--radius)] px-[var(--space-2)] py-[var(--space-2)] t-body font-normal leading-5";
export const SETTINGS_RAIL_DASHBOARD_CLASS = "gap-[var(--space-2)]";
export const SETTINGS_RAIL_ACTIVE_CLASS = "bg-surface-muted text-ink";
export const SETTINGS_RAIL_IDLE_CLASS =
  "text-ink-2 hover:bg-surface-muted hover:text-ink";
export const SETTINGS_RAIL_CHEVRON_CLASS = "size-4 shrink-0";

export const SETTINGS_RAIL_ABSENT = [
  "Titles",
  "Deliveries",
  "Catalog Health",
  "Ask Globee",
  "Queue",
  "Vendors",
  "Clients",
  "Account",
  "Users",
  "API",
  "Appearance",
  "Company",
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

export function isSettingsPath(pathname: string): boolean {
  return settingsPath(pathname) === SETTINGS.href;
}

/** Dashboard is a back door — never the wash. Profile / Agreements follow the hash. */
export function settingsRailActive(kind: SettingsRailKind, section: SettingsSection): boolean {
  return kind !== "dashboard" && kind === section;
}
