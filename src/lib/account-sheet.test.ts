import { describe, expect, it } from "vitest";

import { TEXT_ACTION_CLASS } from "@/lib/house-sheet";
import { USER_MENU, USER_MENU_ACTIONS } from "@/lib/user-menu";
import {
  ACCOUNT_MENU_DROPDOWN_ALIGN,
  ACCOUNT_MENU_DROPDOWN_DISMISS_CLASS,
  ACCOUNT_MENU_DROPDOWN_GAP,
  ACCOUNT_MENU_DROPDOWN_GROUP_CLASS,
  ACCOUNT_MENU_DROPDOWN_HEAD_CLASS,
  ACCOUNT_MENU_DROPDOWN_HOST_CLASS,
  ACCOUNT_MENU_DROPDOWN_IDENTITY_CLASS,
  ACCOUNT_MENU_DROPDOWN_PIN_CLASS,
  ACCOUNT_MENU_DROPDOWN_SCROLL_CLASS,
  ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS,
  accountMenuDropdownAlignEnd,
  ACCOUNT_SHEET,
  ACCOUNT_SHEET_ABSENT,
  ACCOUNT_SHEET_FOOTER_CLASS,
  ACCOUNT_SHEET_HEAD_CLASS,
  ACCOUNT_SHEET_HOST_CLASS,
  ACCOUNT_SHEET_ITEMS,
  ACCOUNT_SHEET_LEGAL_CLASS,
  ACCOUNT_SHEET_LOGOUT_CLASS,
  ACCOUNT_SHEET_LOGOUT_STACK_CLASS,
  ACCOUNT_SHEET_PIN_CLASS,
  ACCOUNT_SHEET_SCROLL_CLASS,
  ACCOUNT_SHEET_SURFACE_CLASS,
  ACCOUNT_SHEET_VERSION_CLASS,
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
    expect(hrefs.join(" ")).not.toMatch(/notifications|phone|job/i);
    expect(hrefs).toContain("/settings/profile");
    expect(hrefs).toContain("/settings/agreements");
    expect(hrefs).toContain("/settings/refer");
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

  it("locks the 544:561 / 537:557 surface: 32 clear under the bar, 48 bottom, sides 24", () => {
    expect(ACCOUNT_SHEET_HOST_CLASS).toContain("justify-end");
    expect(ACCOUNT_SHEET_HOST_CLASS).not.toContain("md:flex-row");
    expect(ACCOUNT_SHEET_HOST_CLASS).not.toContain("md:items-end");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).toContain("h-[90dvh]");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).not.toContain("h-auto");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).not.toContain("max-h-[90dvh]");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).toContain("px-[var(--space-6)]");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).toContain("gap-[var(--space-6)]");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).toContain("pb-[var(--space-12)]");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).not.toContain("pb-[var(--space-8)]");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).toContain("pt-[calc(4px+var(--space-8))]");
    expect(ACCOUNT_SHEET_SURFACE_CLASS.split(" ")).not.toContain("p-[var(--space-6)]");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).toContain("app-sheet-rise");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).not.toContain("md:w-[390px]");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).not.toContain("w-[264px]");
    expect(ACCOUNT_SHEET_SURFACE_CLASS).not.toContain("w-[277px]");
    expect(ACCOUNT_SHEET_HEAD_CLASS).toContain("min-h-12");
    expect(ACCOUNT_SHEET_HEAD_CLASS).toContain("justify-between");
    expect(ACCOUNT_SHEET_HEAD_CLASS).toContain("items-center");
    expect(ACCOUNT_SHEET_SCROLL_CLASS).toContain("flex-1");
    expect(ACCOUNT_SHEET_SCROLL_CLASS).toContain("min-h-0");
    expect(ACCOUNT_SHEET_SCROLL_CLASS).not.toContain("min-h-[var(--space-12)]");
    expect(ACCOUNT_SHEET_SCROLL_CLASS).not.toContain("pb-[var(--space-12)]");
    expect(ACCOUNT_SHEET_SCROLL_CLASS).toContain("overflow-y-auto");
    expect(ACCOUNT_SHEET_LOGOUT_CLASS).toContain("text-accent");
    expect(ACCOUNT_SHEET_LOGOUT_CLASS).not.toContain("text-ink");
    expect(ACCOUNT_SHEET_PIN_CLASS).toContain("gap-[var(--space-12)]");
    expect(ACCOUNT_SHEET_PIN_CLASS).toContain("shrink-0");
    expect(ACCOUNT_SHEET_LOGOUT_STACK_CLASS).toBe("flex w-full shrink-0 flex-col");
    expect(ACCOUNT_SHEET_LOGOUT_STACK_CLASS).not.toContain("gap-");
  });

  it("locks the 586:768 / 586:814 desktop dropdown to 264 × min-h 426 leftover grow", () => {
    expect(ACCOUNT_MENU_DROPDOWN_HOST_CLASS).toBe("fixed inset-0 z-50");
    expect(ACCOUNT_MENU_DROPDOWN_HOST_CLASS).not.toContain("justify-end");
    expect(ACCOUNT_MENU_DROPDOWN_HOST_CLASS).not.toContain("h-dvh");
    expect(ACCOUNT_MENU_DROPDOWN_DISMISS_CLASS).toBe("absolute inset-0");
    expect(ACCOUNT_MENU_DROPDOWN_DISMISS_CLASS).not.toContain("bg-ink");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).toContain("min-h-[426px]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("h-auto");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("min-h-[384px]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("h-[384px]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("w-[384px]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).toContain("w-[264px]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).toContain("rounded-[12px]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).toContain("border-hairline");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).toContain("px-[var(--space-6)]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).toContain("pb-[var(--space-4)]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).toContain("pt-[calc(4px+var(--space-6))]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).toContain("gap-[var(--space-6)]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("px-[var(--space-4)]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("pb-[var(--space-6)]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("gap-[var(--space-4)]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).toContain("overflow-hidden");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("top-[calc(var(--header-height)+var(--space-2))]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("right-[var(--content-inset)]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("--header-height");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("--content-inset");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS.split(" ")).not.toContain("p-[var(--space-6)]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("w-[277px]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("h-[90dvh]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("md:w-[390px]");
    expect(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS).not.toContain("app-sheet-rise");
    expect(ACCOUNT_MENU_DROPDOWN_HEAD_CLASS).toContain("flex-col");
    expect(ACCOUNT_MENU_DROPDOWN_HEAD_CLASS).not.toContain("justify-between");
    expect(ACCOUNT_MENU_DROPDOWN_IDENTITY_CLASS).toContain("flex-col");
    expect(ACCOUNT_MENU_DROPDOWN_IDENTITY_CLASS).toContain("break-words");
    expect(ACCOUNT_MENU_DROPDOWN_IDENTITY_CLASS).not.toContain("truncate");
    expect(ACCOUNT_MENU_DROPDOWN_IDENTITY_CLASS).not.toContain("ellipsis");
    expect(ACCOUNT_MENU_DROPDOWN_GROUP_CLASS).toContain("gap-[var(--space-6)]");
    expect(ACCOUNT_MENU_DROPDOWN_GROUP_CLASS).not.toContain("gap-[var(--space-4)]");
    expect(ACCOUNT_MENU_DROPDOWN_PIN_CLASS).not.toContain("mt-");
    expect(ACCOUNT_MENU_DROPDOWN_PIN_CLASS).toContain("gap-[var(--space-6)]");
    expect(ACCOUNT_MENU_DROPDOWN_PIN_CLASS).not.toContain("gap-[var(--space-12)]");
    expect(ACCOUNT_MENU_DROPDOWN_SCROLL_CLASS).toContain("flex-1");
    expect(ACCOUNT_MENU_DROPDOWN_SCROLL_CLASS).toContain("pb-[var(--space-12)]");
    expect(ACCOUNT_MENU_DROPDOWN_SCROLL_CLASS).not.toContain("min-h-[var(--space-12)]");
    expect(ACCOUNT_MENU_DROPDOWN_SCROLL_CLASS).not.toContain("min-h-0");
    expect(ACCOUNT_MENU_DROPDOWN_SCROLL_CLASS).not.toContain("overflow-y-auto");
  });

  it("docks the desktop menu align-end to the avatar with 8px under the trigger", () => {
    const trigger = { bottom: 44, right: 800 };
    const align = accountMenuDropdownAlignEnd(trigger, 1000);
    const menuRight = 1000 - Number.parseFloat(align.right);

    expect(ACCOUNT_MENU_DROPDOWN_ALIGN).toBe("end");
    expect(ACCOUNT_MENU_DROPDOWN_GAP).toBe("var(--space-2)");
    expect(align.top).toBe("calc(44px + var(--space-2))");
    expect(align.right).toBe("200px");
    expect(menuRight).toBe(trigger.right);
    expect(align.right).not.toBe("48px");
    expect(align.top).not.toContain("--header-height");
    expect(align.right).not.toContain("--content-inset");
  });

  it("locks the footer on both menus to 13 Regular / 16 — version tertiary, Legal Sporty Blue", () => {
    expect(ACCOUNT_SHEET_FOOTER_CLASS).toContain("h-4");
    expect(ACCOUNT_SHEET_VERSION_CLASS).toContain("t-body-sm");
    expect(ACCOUNT_SHEET_VERSION_CLASS).toContain("font-normal");
    expect(ACCOUNT_SHEET_VERSION_CLASS).toContain("leading-4");
    expect(ACCOUNT_SHEET_VERSION_CLASS).toContain("text-ink-3");
    expect(ACCOUNT_SHEET_LEGAL_CLASS).toContain(TEXT_ACTION_CLASS);
    expect(ACCOUNT_SHEET_LEGAL_CLASS).toContain("leading-4");
    expect(ACCOUNT_SHEET_LEGAL_CLASS).toContain("text-accent");
    expect(ACCOUNT_SHEET_LEGAL_CLASS).not.toContain("text-ink-3");
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
    expect(destinationClickClosesSheet("/settings/profile", "/settings/profile")).toBe(true);
    expect(destinationClickClosesSheet("/settings/agreements", "/settings/agreements")).toBe(
      true,
    );
    expect(destinationClickClosesSheet("/settings/refer", "/settings/refer")).toBe(true);
    expect(destinationClickClosesSheet("/settings/profile", "/settings/agreements")).toBe(false);
    expect(destinationClickClosesSheet("/", "/settings/profile")).toBe(false);
    expect(destinationClickClosesSheet("/help", "/help")).toBe(true);
    expect(destinationClickClosesSheet("/settings/profile", "/help")).toBe(false);
  });
});
