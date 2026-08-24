import { describe, expect, it } from "vitest";

import { HELP } from "./help";
import { USER_MENU } from "./user-menu";

describe("help page lock", () => {
  it("is a house empty door — no invented product", () => {
    expect(HELP.title).toBe("Help");
    expect(HELP.href).toBe("/help");
    expect(HELP.href).toBe(USER_MENU.helpHref);
    expect(HELP.empty).toBe("Help is empty.");
    expect(HELP).not.toHaveProperty("articles");
    expect(HELP).not.toHaveProperty("support");
    expect(`${HELP.title} ${HELP.empty}`).not.toMatch(
      /seamless|frictionless|elevate|amplify|unleash|supercharge/i,
    );
  });
});
