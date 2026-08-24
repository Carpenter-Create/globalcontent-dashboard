import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { USER_MENU } from "./user-menu";
import { APPEARANCE, APPEARANCE_OPTIONS } from "./appearance";

const here = dirname(fileURLToPath(import.meta.url));

describe("appearance copy", () => {
  it("is a nested face — icon-only back, Light, Dark, Auto — not a page", () => {
    expect(APPEARANCE.title).toBe("Appearance");
    expect(APPEARANCE.title).toBe(USER_MENU.appearance);
    expect(APPEARANCE.back).toBe("Back");
    expect(APPEARANCE.back).not.toBe("Back to main menu");
    expect(APPEARANCE.light).toBe("Light");
    expect(APPEARANCE.dark).toBe("Dark");
    expect(APPEARANCE.auto).toBe("Auto");
    expect(APPEARANCE_OPTIONS.map((option) => option.kind)).toEqual(["light", "dark", "auto"]);
    expect(APPEARANCE_OPTIONS.map((option) => option.label)).toEqual(["Light", "Dark", "Auto"]);
    expect(APPEARANCE).not.toHaveProperty("href");
    expect(APPEARANCE).not.toHaveProperty("subtitle");
    expect(`${APPEARANCE.title} ${APPEARANCE.back}`).not.toMatch(
      /seamless|frictionless|elevate|amplify|unleash|supercharge/i,
    );
    expect(existsSync(join(here, "../app/(app)/account/appearance/page.tsx"))).toBe(false);
  });
});
