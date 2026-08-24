// /account/appearance copy. Lives in lib/, not JSX.
// Light, Dark, Auto — one selected. Same gc-theme read/write as the
// existing theme system. No phone mockups, no app-icon pack.

import { USER_MENU } from "@/lib/user-menu";

export const APPEARANCE = {
  title: USER_MENU.appearance,
  href: USER_MENU.appearanceHref,
  subtitle: "Light, dark, or match the device.",
  light: "Light",
  dark: "Dark",
  auto: "Auto",
} as const;
