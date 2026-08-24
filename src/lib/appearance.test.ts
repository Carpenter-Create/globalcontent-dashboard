import { describe, expect, it } from "vitest";

import { USER_MENU } from "./user-menu";
import { APPEARANCE } from "./appearance";

describe("appearance copy", () => {
  it("is Appearance at /account/appearance with Light, Dark, Auto", () => {
    expect(APPEARANCE.title).toBe("Appearance");
    expect(APPEARANCE.href).toBe("/account/appearance");
    expect(APPEARANCE.href).toBe(USER_MENU.appearanceHref);
    expect(APPEARANCE.light).toBe("Light");
    expect(APPEARANCE.dark).toBe("Dark");
    expect(APPEARANCE.auto).toBe("Auto");
    expect(`${APPEARANCE.title} ${APPEARANCE.subtitle}`).not.toMatch(
      /seamless|frictionless|elevate|amplify|unleash|supercharge/i,
    );
  });
});
