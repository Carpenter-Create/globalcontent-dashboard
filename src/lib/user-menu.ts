// Account-menu copy and lock. Lives in lib/, not JSX.
// Real items only, Mercury order. User Profile is /account — the same
// page Manage account opens. Company Profile is /account/company.
// Both routes are desktop + mobile (same save). Do not invent
// /account/profile, Notifications, Privacy, or a name derived from
// the email local-part.

export const USER_MENU = {
  userProfile: "User Profile",
  userProfileHref: "/account",
  companyProfile: "Company Profile",
  companyProfileHref: "/account/company",
  agreements: "Agreements",
  agreementsHref: "/account/agreements",
  appearance: "Appearance",
  logOut: "Log out",
} as const;

export const USER_MENU_ABSENT = ["Notifications", "Privacy", "Sign out"] as const;

export type UserMenuAction =
  | {
      kind: "userProfile";
      label: typeof USER_MENU.userProfile;
      href: typeof USER_MENU.userProfileHref;
    }
  | {
      kind: "companyProfile";
      label: typeof USER_MENU.companyProfile;
      href: typeof USER_MENU.companyProfileHref;
    }
  | {
      kind: "agreements";
      label: typeof USER_MENU.agreements;
      href: typeof USER_MENU.agreementsHref;
    }
  | { kind: "appearance"; label: typeof USER_MENU.appearance }
  | { kind: "logOut"; label: typeof USER_MENU.logOut };

export const USER_MENU_ACTIONS: readonly UserMenuAction[] = [
  { kind: "userProfile", label: USER_MENU.userProfile, href: USER_MENU.userProfileHref },
  { kind: "companyProfile", label: USER_MENU.companyProfile, href: USER_MENU.companyProfileHref },
  { kind: "agreements", label: USER_MENU.agreements, href: USER_MENU.agreementsHref },
  { kind: "appearance", label: USER_MENU.appearance },
  { kind: "logOut", label: USER_MENU.logOut },
];

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
