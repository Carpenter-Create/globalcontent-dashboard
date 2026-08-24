import { describe, expect, it } from "vitest";

import { USER_MENU } from "@/lib/user-menu";
import {
  ACCOUNT_SHEET,
  ACCOUNT_SHEET_ABSENT,
  ACCOUNT_SHEET_ITEMS,
  accountSheetIdentity,
  destinationClickClosesSheet,
} from "./account-sheet";

describe("account sheet lock", () => {
  it("keeps Manage account on /account and ACCOUNT items in Figma order", () => {
    expect(ACCOUNT_SHEET.manage).toBe("Manage account");
    expect(ACCOUNT_SHEET.manageHref).toBe("/account");
    expect(ACCOUNT_SHEET.group).toBe("ACCOUNT");
    expect(ACCOUNT_SHEET_ITEMS.map((item) => item.kind)).toEqual([
      "companyProfile",
      "agreements",
    ]);
    expect(ACCOUNT_SHEET_ITEMS.map((item) => item.label)).toEqual([
      "Company Profile",
      "Agreements",
    ]);
    expect(ACCOUNT_SHEET_ITEMS.map((item) => item.kind)).not.toContain("userProfile");
  });

  it("wires only existing or founder-named account routes", () => {
    expect(ACCOUNT_SHEET_ITEMS[0]).toEqual({
      kind: "companyProfile",
      label: "Company Profile",
      href: null,
    });
    expect(ACCOUNT_SHEET_ITEMS[1]).toEqual({
      kind: "agreements",
      label: "Agreements",
      href: USER_MENU.agreementsHref,
    });
    expect(USER_MENU.agreementsHref).toBe("/account/agreements");
    const hrefs = ACCOUNT_SHEET_ITEMS.flatMap((item) => (item.href ? [item.href] : []));
    expect(hrefs).toEqual(["/account/agreements"]);
    expect(hrefs.join(" ")).not.toMatch(/company|profile|settings|notifications/i);
  });

  it("does not dump the rail, theme, User Profile, or Adobe leftovers into the sheet", () => {
    const labels = [
      ACCOUNT_SHEET.manage,
      ACCOUNT_SHEET.group,
      ...ACCOUNT_SHEET_ITEMS.map((item) => item.label),
    ];
    for (const absent of ACCOUNT_SHEET_ABSENT) {
      expect(labels).not.toContain(absent);
    }
  });
});

describe("account sheet identity", () => {
  it("uses the existing email initial and omits name or email when empty", () => {
    const empty = accountSheetIdentity("");
    expect(empty.avatarInitial).toBe("?");
    expect(empty.name).toBeNull();
    expect(empty.email).toBeNull();
    expect(empty.name).not.toBe("—");
    expect(empty.email).not.toBe("—");
  });

  it("shows the real email and no name — never a local-part invention or dash", () => {
    const email = "jane.doe@studio.com";
    const panel = accountSheetIdentity(email);
    expect(panel.name).toBeNull();
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
  });
});
