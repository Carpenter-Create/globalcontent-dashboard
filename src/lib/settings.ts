// /settings copy and doors. Copy lives here, not in JSX.
// Paths only — hash IA is void. Profile persist is the existing
// /account name + avatar path — do not add Storage, SQL, RLS, or auth.
// Agreements and Refer are house empties. Do not invent a listing,
// download, referral product, Phone, Job, or Company on these pages.
// Appearance stays in-menu. Help stays /help.
//
// 600:881 shell — one 220 rail occupies the Access slot on every
// /settings path. Pad 16. ← Dashboard is 16 chevron + 15 Regular.
// Active wash follows the path. Not a second column. Header avatar
// stays. Company off.

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
  refer: USER_MENU.refer,
  referHref: USER_MENU.referHref,
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

export type SettingsSection = "profile" | "agreements" | "refer";

export type SettingsRailKind = "dashboard" | SettingsSection;

export const SETTINGS_LOCAL_NAV = [
  { kind: "dashboard" as const, label: SETTINGS.dashboard, href: SETTINGS.dashboardHref },
  { kind: "profile" as const, label: SETTINGS.profile, href: SETTINGS.profileHref },
  { kind: "agreements" as const, label: SETTINGS.agreements, href: SETTINGS.agreementsHref },
  { kind: "refer" as const, label: SETTINGS.refer, href: SETTINGS.referHref },
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

export function settingsPath(href: string): string {
  const hashAt = href.indexOf("#");
  return hashAt === -1 ? href : href.slice(0, hashAt);
}

export function isSettingsPath(pathname: string): boolean {
  const path = settingsPath(pathname);
  return path === SETTINGS.href || path.startsWith(`${SETTINGS.href}/`);
}

/** Path doors. Unknown or leftover hashes are not a section. */
export function settingsSection(pathname: string | null | undefined): SettingsSection {
  const path = settingsPath(pathname ?? "");
  if (path === SETTINGS.agreementsHref) return "agreements";
  if (path === SETTINGS.referHref) return "refer";
  return "profile";
}

/**
 * Void hash doors on /settings. #agreements still has a leftover
 * destination. Everything else, including #profile, opens Profile.
 */
export function settingsHashDestination(
  hash: string | null | undefined,
): typeof SETTINGS.profileHref | typeof SETTINGS.agreementsHref {
  const value = (hash ?? "").replace(/^#/, "");
  return value === SETTINGS.agreementsHash ? SETTINGS.agreementsHref : SETTINGS.profileHref;
}

/** Dashboard is a back door — never the wash. Active follows the path. */
export function settingsRailActive(kind: SettingsRailKind, section: SettingsSection): boolean {
  return kind !== "dashboard" && kind === section;
}
