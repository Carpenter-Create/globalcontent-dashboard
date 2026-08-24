import { describe, expect, it } from "vitest";

import { USER_MENU, USER_MENU_ACTIONS } from "@/lib/user-menu";
import {
  ACCOUNT_SHEET,
  ACCOUNT_SHEET_ABSENT,
  ACCOUNT_SHEET_ITEMS,
  accountSheetIdentity,
  destinationClickClosesSheet,
} from "./account-sheet";

describe("account sheet lock", () => {
  it("uses the same USER_MENU_ACTIONS list as the desktop menu", () => {
    expect(ACCOUNT_SHEET_ITEMS).toBe(USER_MENU_ACTIONS);
    expect(ACCOUNT_SHEET_ITEMS.map((item) => item.kind)).toEqual([
      "userProfile",
      "companyProfile",
      "agreements",
      "appearance",
      "logOut",
    ]);
    expect(ACCOUNT_SHEET_ITEMS.map((item) => item.label)).toEqual([
      "User Profile",
      "Company Profile",
      "Agreements",
      "Appearance",
      "Log out",
    ]);
  });

  it("wires only existing account routes — Appearance is a door, not a toggle", () => {
    const hrefs = ACCOUNT_SHEET_ITEMS.flatMap((item) => ("href" in item ? [item.href] : []));
    expect(hrefs).toEqual([
      USER_MENU.userProfileHref,
      USER_MENU.companyProfileHref,
      USER_MENU.agreementsHref,
      USER_MENU.appearanceHref,
    ]);
    expect(USER_MENU.appearanceHref).toBe("/account/appearance");
    expect(hrefs.join(" ")).not.toMatch(/settings|notifications/i);
    expect(hrefs).not.toContain("/account/profile");
  });

  it("does not dump the rail, Manage account, ACCOUNT, or Adobe leftovers into the sheet", () => {
    const labels = ACCOUNT_SHEET_ITEMS.map((item) => item.label);
    expect(labels).not.toContain("Manage account");
    expect(ACCOUNT_SHEET).not.toHaveProperty("manage");
    expect(ACCOUNT_SHEET).not.toHaveProperty("group");
    for (const absent of ACCOUNT_SHEET_ABSENT) {
      expect(labels).not.toContain(absent);
    }
  });
});

describe("account sheet identity", () => {
  it("keeps name and email fields without dashes when empty", () => {
    const empty = accountSheetIdentity("");
    expect(empty.avatarInitial).toBe("?");
    expect(empty.name).toBe("");
    expect(empty.email).toBe("");
    expect(empty.name).not.toBe("—");
    expect(empty.email).not.toBe("—");
  });

  it("shows the real email and an empty name — never a local-part invention or dash", () => {
    const email = "jane.doe@studio.com";
    const panel = accountSheetIdentity(email);
    expect(panel.name).toBe("");
    expect(panel.email).toBe(email);
    expect(panel.avatarInitial).toBe("J");
    expect(panel.name).not.toBe("Jane Doe");
    expect(panel.name).not.toBe("jane.doe");
    expect(panel.name).not.toBe("—");
  });

  it("shows a name only when the caller already has one", () => {
    const named = accountSheetIdentity("ada@example.com", "Ada Lovelace");
    expect(named.name).toBe("Ada Lovelace");
    expect(named.email).toBe("ada@example.com");
    expect(named.avatarInitial).toBe("A");
    expect(accountSheetIdentity("ada@example.com", "   ")).toEqual(
      accountSheetIdentity("ada@example.com"),
    );
  });
});

describe("account sheet destination close", () => {
  it("closes immediately only on the same href", () => {
    expect(destinationClickClosesSheet("/account", "/account")).toBe(true);
    expect(destinationClickClosesSheet("/", "/account")).toBe(false);
    expect(destinationClickClosesSheet("/account/agreements", "/account/agreements")).toBe(true);
    expect(destinationClickClosesSheet("/account", "/account/agreements")).toBe(false);
    expect(destinationClickClosesSheet("/account/appearance", "/account/appearance")).toBe(true);
  });
});
