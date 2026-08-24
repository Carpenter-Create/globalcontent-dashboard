import { describe, expect, it } from "vitest";

import { REFER } from "./refer";
import { USER_MENU } from "./user-menu";

describe("refer page lock", () => {
  it("is a house empty door — no invented product", () => {
    expect(REFER.title).toBe("Refer a friend");
    expect(REFER.href).toBe("/settings/refer");
    expect(REFER.href).toBe(USER_MENU.referHref);
    expect(REFER.empty).toBe("Refer a friend is empty.");
    expect(REFER).not.toHaveProperty("reward");
    expect(REFER).not.toHaveProperty("share");
    expect(`${REFER.title} ${REFER.empty}`).not.toMatch(
      /seamless|frictionless|elevate|amplify|unleash|supercharge/i,
    );
  });
});
