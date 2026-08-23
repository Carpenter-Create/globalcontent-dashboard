import { describe, expect, it } from "vitest";

import { USER_MENU } from "@/lib/user-menu";
import {
  ACCOUNT_OVERLAY,
  ACCOUNT_OVERLAY_ABSENT,
  ACCOUNT_OVERLAY_ITEMS,
  accountOverlayIdentity,
  destinationClickClosesOverlay,
} from "./account-overlay";

describe("account overlay lock", () => {
  it("keeps Manage account on /account and ACCOUNT items in Figma order", () => {
    expect(ACCOUNT_OVERLAY.manage).toBe("Manage account");
    expect(ACCOUNT_OVERLAY.manageHref).toBe("/account");
    expect(ACCOUNT_OVERLAY.group).toBe("ACCOUNT");
    expect(ACCOUNT_OVERLAY_ITEMS.map((item) => item.kind)).toEqual([
      "userProfile",
      "companyProfile",
      "agreements",
    ]);
    expect(ACCOUNT_OVERLAY_ITEMS.map((item) => item.label)).toEqual([
      "User Profile",
      "Company Profile",
      "Agreements",
    ]);
  });

  it("wires only existing or founder-named account routes", () => {
    expect(ACCOUNT_OVERLAY_ITEMS[0]).toEqual({
      kind: "userProfile",
      label: "User Profile",
      href: "/account",
    });
    expect(ACCOUNT_OVERLAY_ITEMS[1]).toEqual({
      kind: "companyProfile",
      label: "Company Profile",
      href: null,
    });
    expect(ACCOUNT_OVERLAY_ITEMS[2]).toEqual({
      kind: "agreements",
      label: "Agreements",
      href: USER_MENU.agreementsHref,
    });
    expect(USER_MENU.agreementsHref).toBe("/account/agreements");
    const hrefs = ACCOUNT_OVERLAY_ITEMS.flatMap((item) => (item.href ? [item.href] : []));
    expect(hrefs).toEqual(["/account", "/account/agreements"]);
    expect(hrefs.join(" ")).not.toMatch(/company|profile|settings|notifications/i);
  });

  it("does not dump the rail, theme, or Adobe leftovers into the overlay", () => {
    const labels = [
      ACCOUNT_OVERLAY.manage,
      ACCOUNT_OVERLAY.group,
      ...ACCOUNT_OVERLAY_ITEMS.map((item) => item.label),
    ];
    for (const absent of ACCOUNT_OVERLAY_ABSENT) {
      expect(labels).not.toContain(absent);
    }
  });
});

describe("account overlay identity", () => {
  it("uses the existing email initial and dashes when name or email is empty", () => {
    const empty = accountOverlayIdentity("");
    expect(empty.avatarInitial).toBe("?");
    expect(empty.name).toBe("—");
    expect(empty.email).toBe("—");
    expect(empty.name).toBe(ACCOUNT_OVERLAY.empty);
    expect(empty.email).toBe(ACCOUNT_OVERLAY.empty);
  });

  it("shows the real email and a dash name — never a local-part invention", () => {
    const email = "jane.doe@studio.com";
    const panel = accountOverlayIdentity(email);
    expect(panel.name).toBe("—");
    expect(panel.email).toBe(email);
    expect(panel.avatarInitial).toBe("J");
    expect(panel.name).not.toBe("Jane Doe");
    expect(panel.name).not.toBe("jane.doe");
  });

  it("shows a name only when the caller already has one", () => {
    const named = accountOverlayIdentity("ada@example.com", "Ada Lovelace");
    expect(named.name).toBe("Ada Lovelace");
    expect(named.email).toBe("ada@example.com");
    expect(named.avatarInitial).toBe("A");
    expect(accountOverlayIdentity("ada@example.com", "   ")).toEqual(
      accountOverlayIdentity("ada@example.com"),
    );
  });
});

describe("account overlay destination close", () => {
  it("closes immediately only on the same href", () => {
    expect(destinationClickClosesOverlay("/account", "/account")).toBe(true);
    expect(destinationClickClosesOverlay("/", "/account")).toBe(false);
    expect(destinationClickClosesOverlay("/account/agreements", "/account/agreements")).toBe(
      true,
    );
    expect(destinationClickClosesOverlay("/account", "/account/agreements")).toBe(false);
  });
});
