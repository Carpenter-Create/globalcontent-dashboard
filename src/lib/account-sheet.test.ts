import { describe, expect, it } from "vitest";

import { USER_MENU, USER_MENU_ACTIONS } from "@/lib/user-menu";
import {
  ACCOUNT_SHEET,
  ACCOUNT_SHEET_ABSENT,
  ACCOUNT_SHEET_HEAD_CLASS,
  ACCOUNT_SHEET_ITEMS,
  ACCOUNT_SHEET_LOGOUT_CLASS,
  ACCOUNT_SHEET_SURFACE_CLASS,
  accountSheetIdentity,
  destinationClickClosesSheet,
} from "./account-sheet";

describe("account sheet lock", () => {
  it("uses the same USER_MENU_ACTIONS list as the desktop menu", () => {
    expect(ACCOUNT_SHEET_ITEMS).toBe(USER_MENU_ACTIONS);
    expect(ACCOUNT_SHEET_ITEMS.map((item) => item.kind)).toEqual([
      "profile",
      "agreements",
      "appearance",
      "help",
      "refer",
    ]);
    expect(ACCOUNT_SHEET_ITEMS.map((item) => item.label)).toEqual([
      "Profile",
      "Agreements",
      "Appearance",
      "Help",
      "Refer a friend",
    ]);
  });

  it("wires only existing routes — Appearance is a nested face, not a page", () => {
    const hrefs = ACCOUNT_SHEET_ITEMS.flatMap((item) => ("href" in item ? [item.href] : []));
    expect(hrefs).toEqual([
      USER_MENU.profileHref,
      USER_MENU.agreementsHref,
      USER_MENU.helpHref,
      USER_MENU.referHref,
    ]);
    expect(USER_MENU).not.toHaveProperty("appearanceHref");
    expect(hrefs).not.toContain("/account/appearance");
    expect(hrefs).not.toContain("/account/company");
    expect(hrefs.join(" ")).not.toMatch(/settings|notifications|phone|job/i);
    expect(hrefs).not.toContain("/account/profile");
  });

  it("does not dump the rail, Company, Phone, Job, or Adobe leftovers into the sheet", () => {
    const labels = ACCOUNT_SHEET_ITEMS.map((item) => item.label);
    expect(labels).not.toContain("Manage account");
    expect(ACCOUNT_SHEET).not.toHaveProperty("manage");
    expect(ACCOUNT_SHEET).not.toHaveProperty("group");
    for (const absent of ACCOUNT_SHEET_ABSENT) {
      expect(labels).not.toContain(absent);
    }
  });

  it("locks the 544:561 / 569:639 surface: pad 24, 90vh, Identity + Close one row", () => {
    expect(ACCOUNT_SHEET_SURFACE_CLASS).toContain("h-[90dvh]");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).toContain("p-[var(--space-6)]");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).toContain("md:w-[390px]");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).toContain("app-sheet-rise");
    expect(ACCOUNT_SHEET_HEAD_CLASS).toContain("min-h-12");
    expect(ACCOUNT_SHEET_HEAD_CLASS).toContain("justify-between");
    expect(ACCOUNT_SHEET_HEAD_CLASS).toContain("items-center");
    expect(ACCOUNT_SHEET_LOGOUT_CLASS).toContain("text-accent");
    expect(ACCOUNT_SHEET_LOGOUT_CLASS).not.toContain("text-ink");
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
    expect(destinationClickClosesSheet("/help", "/help")).toBe(true);
    expect(destinationClickClosesSheet("/refer", "/refer")).toBe(true);
  });
});
