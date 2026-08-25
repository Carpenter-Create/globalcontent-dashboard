import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { USER_MENU } from "./user-menu";
import {
  APPEARANCE,
  APPEARANCE_FLYOUT_OPTIONS,
  APPEARANCE_OPTIONS,
  appearancePreferenceLabel,
} from "./appearance";

const here = dirname(fileURLToPath(import.meta.url));

describe("appearance copy", () => {
  it("is a second 613:888 surface — System default / Dark / Light — not a page", () => {
    expect(APPEARANCE.title).toBe("Appearance");
    expect(APPEARANCE.title).toBe(USER_MENU.appearance);
    expect(APPEARANCE.back).toBe("Back");
    expect(APPEARANCE.back).not.toBe("Back to main menu");
    expect(APPEARANCE.light).toBe("Light");
    expect(APPEARANCE.dark).toBe("Dark");
    expect(APPEARANCE.systemDefault).toBe("System default");
    expect(APPEARANCE.systemDefaultHelper).toBe("We'll match your system preferences");
    expect(APPEARANCE_FLYOUT_OPTIONS.map((option) => option.kind)).toEqual([
      "auto",
      "dark",
      "light",
    ]);
    expect(APPEARANCE_FLYOUT_OPTIONS.map((option) => option.label)).toEqual([
      "System default",
      "Dark",
      "Light",
    ]);
    expect(APPEARANCE_FLYOUT_OPTIONS[0]).toMatchObject({
      helper: APPEARANCE.systemDefaultHelper,
    });
    expect(appearancePreferenceLabel("light")).toBe("Light");
    expect(appearancePreferenceLabel("dark")).toBe("Dark");
    expect(appearancePreferenceLabel("auto")).toBe("System default");
    expect(APPEARANCE).not.toHaveProperty("href");
    expect(`${APPEARANCE.title} ${APPEARANCE.systemDefault}`).not.toMatch(
      /seamless|frictionless|elevate|amplify|unleash|supercharge/i,
    );
    expect(existsSync(join(here, "../app/(app)/account/appearance/page.tsx"))).toBe(false);
  });

  it("keeps the unused in-place Auto list off the 613:888 surface", () => {
    expect(APPEARANCE.auto).toBe("Auto");
    expect(APPEARANCE_OPTIONS.map((option) => option.label)).toEqual(["Light", "Dark", "Auto"]);
    expect(APPEARANCE_FLYOUT_OPTIONS.map((option) => option.label)).not.toContain("Auto");
  });
});
