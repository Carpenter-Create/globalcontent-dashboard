// Account-menu copy and lock. Lives in lib/, not JSX.
// Real items only. Do not invent Profile, Notifications, Security, Perks,
// or a name derived from the email local-part.

import type { ThemePreference } from "@/lib/theme";

export const USER_MENU = {
  agreements: "Agreements",
  agreementsHref: "/account/agreements",
  privacy: "Privacy",
  privacyHref: "https://globalcontent.co/legal/privacy",
  appearance: "Appearance",
  appearanceLight: "Light mode",
  appearanceDark: "Dark mode",
  appearanceSystem: "System default",
  appearanceSystemHint: "We'll match your system preferences.",
  logOut: "Log out",
} as const;

export const USER_MENU_ABSENT = [
  "Profile",
  "Notifications",
  "Security",
  "Perks",
  "Sign out",
] as const;

export type UserMenuAction =
  | {
      kind: "agreements";
      label: typeof USER_MENU.agreements;
      href: typeof USER_MENU.agreementsHref;
    }
  | {
      kind: "privacy";
      label: typeof USER_MENU.privacy;
      href: typeof USER_MENU.privacyHref;
    }
  | { kind: "appearance"; label: typeof USER_MENU.appearance }
  | { kind: "logOut"; label: typeof USER_MENU.logOut };

export const USER_MENU_ACTIONS: readonly UserMenuAction[] = [
  { kind: "agreements", label: USER_MENU.agreements, href: USER_MENU.agreementsHref },
  { kind: "privacy", label: USER_MENU.privacy, href: USER_MENU.privacyHref },
  { kind: "appearance", label: USER_MENU.appearance },
  { kind: "logOut", label: USER_MENU.logOut },
];

export const USER_MENU_APPEARANCE_OPTIONS = [
  {
    preference: "system",
    label: USER_MENU.appearanceSystem,
    hint: USER_MENU.appearanceSystemHint,
  },
  { preference: "dark", label: USER_MENU.appearanceDark },
  { preference: "light", label: USER_MENU.appearanceLight },
] as const;

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

export function userMenuAppearanceLabel(preference: ThemePreference): string {
  if (preference === "dark") return USER_MENU.appearanceDark;
  if (preference === "system") return USER_MENU.appearanceSystem;
  return USER_MENU.appearanceLight;
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
