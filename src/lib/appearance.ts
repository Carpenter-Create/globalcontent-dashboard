// Account-menu Appearance. Lives in lib/, not JSX.
// 613:888 — System default + helper / Dark / Light. Selected is a
// quiet 16 check. Not a page. Not radios. Existing gc-theme kinds
// stay light / dark / auto — auto is System default on the surface.
// Desktop: second 264 surface, gap 8 left of 586:768. Mobile 618:785:
// same rows and type, second surface ON the 90% sheet at x=24 w=342,
// gap 8 under Appearance. Not leftover. Not beside. Not an in-place
// replace.

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

// Mobile 544:561 in-place face used this order. Void — 613:888 is
// System default / Dark / Light on both instances.
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
