// Account-menu Appearance face. Lives in lib/, not JSX.
// Not a page. Light, Dark, Auto are the same account-menu rows.
// Selected is a quiet check. Back to main menu returns to the first
// face. Desktop nests the same. Existing gc-theme + Auto. No radios,
// no /account/appearance door, no Mercury mockups, no icon pack.

import { USER_MENU } from "@/lib/user-menu";

export type AccountMenuFace = "main" | "appearance";

export const APPEARANCE = {
  title: USER_MENU.appearance,
  back: "Back to main menu",
  light: "Light",
  dark: "Dark",
  auto: "Auto",
} as const;

export const APPEARANCE_OPTIONS = [
  { kind: "light", label: APPEARANCE.light },
  { kind: "dark", label: APPEARANCE.dark },
  { kind: "auto", label: APPEARANCE.auto },
] as const;
