// /settings copy and doors. Copy lives here, not in JSX.
// Paths only. Profile persist is the existing /account name + avatar
// path — do not add Storage, SQL, RLS, or auth. Agreements and Refer
// are house empties. Do not invent a listing, download, referral
// product, Phone, Job, or Company on these pages. Appearance stays
// in-menu. Help stays /help.
//
// 600:881 shell — one 220 rail occupies the Access slot on every
// /settings path. Pad 16. ← Dashboard is 16 chevron + 15 Regular.
// Active wash follows the path. Not a second column. Header avatar
// stays. Company off.
//
// 623:785 phone header — same ← Dashboard back in the left slot.
// 16 chevron + 15 Regular, gap 8, pad 24, href /. No hamburger.
// Avatar 32 stays. Not a new IA. Appearance stays in-menu.

import { USER_MENU } from "@/lib/user-menu";

export const SETTINGS = {
  href: "/settings",
  profile: USER_MENU.profile,
  profileHref: USER_MENU.profileHref,
  agreements: USER_MENU.agreements,
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

// 623:785 — phone header left slot. Same 16 + 15 Regular + gap 8
// as the 600:881 rail Dashboard row. Pad 24 is the existing header
// inset. Hidden at md, where the rail stays.
export const SETTINGS_HEADER_PAD_CLASS = "px-[var(--space-6)]";
export const SETTINGS_HEADER_BACK_CLASS =
  "flex items-center gap-[var(--space-2)] t-body font-normal md:hidden";

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

export function isSettingsPath(pathname: string): boolean {
  return pathname === SETTINGS.href || pathname.startsWith(`${SETTINGS.href}/`);
}

/** Path doors. Unknown paths open Profile. */
export function settingsSection(pathname: string | null | undefined): SettingsSection {
  if (pathname === SETTINGS.agreementsHref) return "agreements";
  if (pathname === SETTINGS.referHref) return "refer";
  return "profile";
}

/** Dashboard is a back door — never the wash. Active follows the path. */
export function settingsRailActive(kind: SettingsRailKind, section: SettingsSection): boolean {
  return kind !== "dashboard" && kind === section;
}
