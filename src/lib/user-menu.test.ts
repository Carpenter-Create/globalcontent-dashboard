import { describe, expect, it } from "vitest";

import {
  USER_MENU,
  USER_MENU_ABSENT,
  USER_MENU_ACTIONS,
  userMenuAvatarInitial,
  userMenuName,
  userMenuPanel,
  userMenuVersion,
} from "./user-menu";

describe("user menu lock", () => {
  it("keeps the same Identity rows on mobile and desktop: Profile, Agreements, Appearance, Help, Refer a friend", () => {
    expect(USER_MENU_ACTIONS.map((item) => item.kind)).toEqual([
      "profile",
      "agreements",
      "appearance",
      "help",
      "refer",
    ]);
    expect(USER_MENU_ACTIONS.map((item) => item.label)).toEqual([
      "Profile",
      "Agreements",
      "Appearance",
      "Help",
      "Refer a friend",
    ]);
  });

  it("points each door at its existing route — Appearance is not a page", () => {
    expect(USER_MENU.profileHref).toBe("/settings/profile");
    expect(USER_MENU.agreementsHref).toBe("/settings/agreements");
    expect(USER_MENU.helpHref).toBe("/help");
    expect(USER_MENU.referHref).toBe("/settings/refer");
    expect(USER_MENU.legalHref).toBe("https://globalcontent.co/legal");
    expect(USER_MENU).not.toHaveProperty("appearanceHref");
    expect(USER_MENU).not.toHaveProperty("companyProfile");
    expect(USER_MENU).not.toHaveProperty("companyProfileHref");
    expect(USER_MENU.appearance).toBe("Appearance");
    expect(USER_MENU_ACTIONS[0]).toEqual({
      kind: "profile",
      label: "Profile",
      href: "/settings/profile",
    });
    expect(USER_MENU_ACTIONS[1]).toEqual({
      kind: "agreements",
      label: "Agreements",
      href: "/settings/agreements",
    });
    expect(USER_MENU_ACTIONS[2]).toEqual({
      kind: "appearance",
      label: "Appearance",
    });
    expect(USER_MENU_ACTIONS[3]).toEqual({
      kind: "help",
      label: "Help",
      href: "/help",
    });
    expect(USER_MENU_ACTIONS[4]).toEqual({
      kind: "refer",
      label: "Refer a friend",
      href: "/settings/refer",
    });
  });

  it("does not invent /account/appearance, /account/profile, Company, Phone, Job, or leftovers", () => {
    const labels = USER_MENU_ACTIONS.map((item) => item.label);
    const hrefs = USER_MENU_ACTIONS.flatMap((item) => ("href" in item ? [item.href] : []));
    for (const absent of USER_MENU_ABSENT) {
      expect(labels).not.toContain(absent);
    }
    expect(labels).toContain("Profile");
    expect(labels).not.toContain("User Profile");
    expect(hrefs).toEqual([
      "/settings/profile",
      "/settings/agreements",
      "/help",
      "/settings/refer",
    ]);
    expect(hrefs).not.toContain("/account/appearance");
    expect(hrefs).not.toContain("/account/profile");
    expect(hrefs).not.toContain("/account/company");
    expect(hrefs).not.toContain("/settings#profile");
    expect(hrefs).not.toContain("/settings#agreements");
    expect(hrefs.join(" ")).not.toMatch(/notifications|privacy|phone|job/i);
  });

  it("pins Legal to the public site and versions from package.json", () => {
    expect(USER_MENU.legal).toBe("Legal");
    expect(USER_MENU.legalHref).toBe("https://globalcontent.co/legal");
    expect(userMenuVersion()).toBe("v0.1.0");
    expect(USER_MENU.versionPrefix).toBe("v");
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
