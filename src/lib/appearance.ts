// Account-menu Appearance. Lives in lib/, not JSX.
// 613:888 — System default + helper / Dark / Light. Selected is a
// quiet 16 check. Not a page. Not radios. Existing gc-theme kinds
// stay light / dark / auto — auto is System default on the surface.
// Desktop: second 264 surface, gap 8 left of 586:768. Mobile is a
// same-sheet drill-in — Open Appearance replaces the list face;
// house 16 tertiary Back returns to main. 618:785 overlay is void.
// Not a route. Not a second sheet. Not a card on the sheet.

import { USER_MENU } from "@/lib/user-menu";
import type { ThemePreference } from "@/lib/theme";

export type AccountMenuFace = "main" | "appearance";

export const APPEARANCE = {
  title: USER_MENU.appearance,
  back: "Back",
  light: "Light",
  dark: "Dark",
  auto: "Auto",
  systemDefault: "System default",
  systemDefaultHelper: "We'll match your system preferences",
} as const;

// Unused Light / Dark / Auto list. Both instances use
// System default / Dark / Light.
export const APPEARANCE_OPTIONS = [
  { kind: "light", label: APPEARANCE.light },
  { kind: "dark", label: APPEARANCE.dark },
  { kind: "auto", label: APPEARANCE.auto },
] as const;

export const APPEARANCE_FLYOUT_OPTIONS = [
  {
    kind: "auto",
    label: APPEARANCE.systemDefault,
    helper: APPEARANCE.systemDefaultHelper,
  },
  { kind: "dark", label: APPEARANCE.dark },
  { kind: "light", label: APPEARANCE.light },
] as const;

export function appearancePreferenceLabel(preference: ThemePreference): string {
  if (preference === "dark") return APPEARANCE.dark;
  if (preference === "auto") return APPEARANCE.systemDefault;
  return APPEARANCE.light;
}
