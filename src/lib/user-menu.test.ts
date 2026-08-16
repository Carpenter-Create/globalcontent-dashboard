import { describe, expect, it } from "vitest";

import {
  USER_MENU,
  USER_MENU_ABSENT,
  USER_MENU_ACTIONS,
  userMenuAvatarInitial,
  userMenuName,
  userMenuPanel,
} from "./user-menu";

describe("user menu lock", () => {
  it("keeps Mercury order: Agreements, Appearance, Log out", () => {
    expect(USER_MENU_ACTIONS.map((item) => item.kind)).toEqual([
      "agreements",
      "appearance",
      "logOut",
    ]);
    expect(USER_MENU_ACTIONS.map((item) => item.label)).toEqual([
      "Agreements",
      "Appearance",
      "Log out",
    ]);
  });

  it("points Agreements at the existing account page only", () => {
    expect(USER_MENU.agreementsHref).toBe("/account/agreements");
    expect(USER_MENU_ACTIONS[0]).toEqual({
      kind: "agreements",
      label: "Agreements",
      href: "/account/agreements",
    });
  });

  it("does not include Profile, Notifications, Privacy, or Sign out", () => {
    const labels = USER_MENU_ACTIONS.map((item) => item.label);
    const hrefs = USER_MENU_ACTIONS.flatMap((item) => ("href" in item ? [item.href] : []));
    for (const absent of USER_MENU_ABSENT) {
      expect(labels).not.toContain(absent);
    }
    expect(hrefs).toEqual(["/account/agreements"]);
    expect(hrefs.join(" ")).not.toMatch(/profile|notifications|privacy/i);
  });
});

describe("user menu identity", () => {
  it("uses the email initial for the avatar, not a fabricated name", () => {
    expect(userMenuAvatarInitial("ada@example.com")).toBe("A");
    expect(userMenuAvatarInitial("  nina@studio.com")).toBe("N");
    expect(userMenuAvatarInitial("")).toBe("?");
  });

  it("omits the name row unless a real display name is already present", () => {
    expect(userMenuName(undefined)).toBeNull();
    expect(userMenuName(null)).toBeNull();
    expect(userMenuName("")).toBeNull();
    expect(userMenuName("   ")).toBeNull();
    expect(userMenuName("Ada Lovelace")).toBe("Ada Lovelace");
    expect(userMenuName("  Ada Lovelace  ")).toBe("Ada Lovelace");
  });

  it("does not derive a name from the email local-part", () => {
    const email = "jane.doe@studio.com";
    const panel = userMenuPanel(email);
    expect(panel.name).toBeNull();
    expect(panel.email).toBe(email);
    expect(panel.avatarInitial).toBe("J");
    expect(userMenuName(email.split("@")[0])).not.toBe(panel.name);
  });

  it("shows a name only when the caller already has one", () => {
    const named = userMenuPanel("ada@example.com", "Ada Lovelace");
    expect(named.name).toBe("Ada Lovelace");
    expect(named.email).toBe("ada@example.com");
    expect(named.actions).toEqual(USER_MENU_ACTIONS);
  });
});
