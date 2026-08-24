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
  it("keeps Mercury order: User Profile, Company Profile, Agreements, Appearance, Log out", () => {
    expect(USER_MENU_ACTIONS.map((item) => item.kind)).toEqual([
      "userProfile",
      "companyProfile",
      "agreements",
      "appearance",
      "logOut",
    ]);
    expect(USER_MENU_ACTIONS.map((item) => item.label)).toEqual([
      "User Profile",
      "Company Profile",
      "Agreements",
      "Appearance",
      "Log out",
    ]);
  });

  it("points each door at its existing route — Appearance is /account/appearance", () => {
    expect(USER_MENU.userProfileHref).toBe("/account");
    expect(USER_MENU.companyProfileHref).toBe("/account/company");
    expect(USER_MENU.agreementsHref).toBe("/account/agreements");
    expect(USER_MENU.appearanceHref).toBe("/account/appearance");
    expect(USER_MENU_ACTIONS[0]).toEqual({
      kind: "userProfile",
      label: "User Profile",
      href: "/account",
    });
    expect(USER_MENU_ACTIONS[1]).toEqual({
      kind: "companyProfile",
      label: "Company Profile",
      href: "/account/company",
    });
    expect(USER_MENU_ACTIONS[2]).toEqual({
      kind: "agreements",
      label: "Agreements",
      href: "/account/agreements",
    });
    expect(USER_MENU_ACTIONS[3]).toEqual({
      kind: "appearance",
      label: "Appearance",
      href: "/account/appearance",
    });
  });

  it("does not invent /account/profile, Manage account, Notifications, Privacy, or Sign out", () => {
    const labels = USER_MENU_ACTIONS.map((item) => item.label);
    const hrefs = USER_MENU_ACTIONS.flatMap((item) => ("href" in item ? [item.href] : []));
    for (const absent of USER_MENU_ABSENT) {
      expect(labels).not.toContain(absent);
    }
    expect(labels).not.toContain("Profile");
    expect(hrefs).toEqual([
      "/account",
      "/account/company",
      "/account/agreements",
      "/account/appearance",
    ]);
    expect(hrefs).not.toContain("/account/profile");
    expect(hrefs.join(" ")).not.toMatch(/notifications|privacy|settings/i);
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
