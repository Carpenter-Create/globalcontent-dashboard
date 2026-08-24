// Account-menu copy and lock. Lives in lib/, not JSX.
// One list for both instances: desktop panel and mobile sheet.
// Chrome may differ (sheet vs fuller panel). Labels may not.
// Profile is /account only. Company stays off this menu — do not merge
// Company onto /account. Agreements is /account/agreements. Appearance
// is a second face, not a page — do not invent /account/appearance.
// Help and Refer are house empty pages. Legal is the public site.
// Do not invent /account/profile, Phone, Job, Notifications, Privacy,
// Manage account, or a name derived from the email local-part.

import { version as APP_VERSION } from "../../package.json";

export const USER_MENU = {
  profile: "Profile",
  profileHref: "/account",
  agreements: "Agreements",
  agreementsHref: "/account/agreements",
  appearance: "Appearance",
  help: "Help",
  helpHref: "/help",
  refer: "Refer a friend",
  referHref: "/refer",
  logOut: "Log out",
  legal: "Legal",
  legalHref: "https://globalcontent.co/legal",
  versionPrefix: "v",
} as const;

export const USER_MENU_ABSENT = [
  "Manage account",
  "Notifications",
  "Privacy",
  "Sign out",
  "User Profile",
  "Company Profile",
  "Phone",
  "Job",
] as const;

export type UserMenuLinkAction =
  | {
      kind: "profile";
      label: typeof USER_MENU.profile;
      href: typeof USER_MENU.profileHref;
    }
  | {
      kind: "agreements";
      label: typeof USER_MENU.agreements;
      href: typeof USER_MENU.agreementsHref;
    }
  | {
      kind: "help";
      label: typeof USER_MENU.help;
      href: typeof USER_MENU.helpHref;
    }
  | {
      kind: "refer";
      label: typeof USER_MENU.refer;
      href: typeof USER_MENU.referHref;
    };

export type UserMenuAction =
  | UserMenuLinkAction
  | { kind: "appearance"; label: typeof USER_MENU.appearance };

export const USER_MENU_ACTIONS: readonly UserMenuAction[] = [
  { kind: "profile", label: USER_MENU.profile, href: USER_MENU.profileHref },
  { kind: "agreements", label: USER_MENU.agreements, href: USER_MENU.agreementsHref },
  { kind: "appearance", label: USER_MENU.appearance },
  { kind: "help", label: USER_MENU.help, href: USER_MENU.helpHref },
  { kind: "refer", label: USER_MENU.refer, href: USER_MENU.referHref },
];

export function userMenuVersion(): string {
  return `${USER_MENU.versionPrefix}${APP_VERSION}`;
}

/** Avatar letter from the email. Not a name. */
export function userMenuAvatarInitial(email: string): string {
  return (email.trim().charAt(0) || "?").toUpperCase();
}

/**
 * A real display name only. Empty or whitespace is absent.
 * Never derive a name from an email — callers must pass a name that
 * already exists, or omit it.
 */
export function userMenuName(name: string | null | undefined): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type UserMenuPanelModel = {
  avatarInitial: string;
  name: string | null;
  email: string;
  actions: readonly UserMenuAction[];
};

export function userMenuPanel(email: string, name?: string | null): UserMenuPanelModel {
  return {
    avatarInitial: userMenuAvatarInitial(email),
    name: userMenuName(name),
    email,
    actions: USER_MENU_ACTIONS,
  };
}
