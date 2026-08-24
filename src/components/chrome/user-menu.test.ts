import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { USER_MENU, USER_MENU_ABSENT, USER_MENU_ACTIONS } from "@/lib/user-menu";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/actions", () => ({ signOut: vi.fn() }));

import { signOut } from "@/app/actions";
import { APPEARANCE } from "@/lib/appearance";
import { onUserMenuLogOut, UserMenu, UserMenuIdentity } from "./user-menu";

const here = dirname(fileURLToPath(import.meta.url));
const menuSrc = readFileSync(join(here, "user-menu.tsx"), "utf8");
const sheetSrc = readFileSync(join(here, "account-sheet.tsx"), "utf8");

function visibleText(html: string): string {
  return html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
}

describe("UserMenuIdentity", () => {
  it("renders avatar and email, and omits a name when none is provided", () => {
    const html = renderToStaticMarkup(
      createElement(UserMenuIdentity, { email: "ada@example.com" }),
    );
    expect(html).toContain('data-user-menu-avatar=""');
    expect(html).toContain('data-user-menu-email=""');
    expect(html).toContain("ada@example.com");
    expect(html).toContain(">A<");
    expect(html).toContain("size-12");
    expect(html).toContain("t-body-sm text-ink-3");
    expect(html).not.toContain("data-user-menu-name");
    expect(visibleText(html)).not.toMatch(/Notifications|Privacy|Phone|Job/);
  });

  it("renders a name row only when a real display name is passed", () => {
    const html = renderToStaticMarkup(
      createElement(UserMenuIdentity, { email: "ada@example.com", name: "Ada Lovelace" }),
    );
    expect(html).toContain('data-user-menu-name=""');
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("t-body font-normal text-ink");
    expect(html).toContain("t-body-sm text-ink-3");
  });

  it("does not invent a name from the email local-part", () => {
    const html = renderToStaticMarkup(
      createElement(UserMenuIdentity, { email: "jane.doe@studio.com" }),
    );
    expect(html).not.toContain("data-user-menu-name");
    expect(html).not.toContain("Jane Doe");
    expect(html).toContain("jane.doe@studio.com");
  });
});

describe("UserMenu trigger", () => {
  it("shows the email initial and does not mount a header theme control", () => {
    const html = renderToStaticMarkup(createElement(UserMenu, { email: "nina@studio.com" }));
    expect(html).toContain('data-user-menu-trigger=""');
    expect(html).toContain("N");
    expect(html).not.toContain("Switch to dark mode");
    expect(html).not.toContain("Switch to light mode");
  });
});

describe("UserMenu close control", () => {
  it("opens the mobile 544:561 / 537:557 sheet and the desktop 586:768 dropdown from the avatar", () => {
    expect(menuSrc).toContain("MobileAccountMenu");
    expect(menuSrc).toContain("DesktopAccountMenu");
    expect(menuSrc).toContain("<MobileAccountMenu email={email} name={name} />");
    expect(menuSrc).toContain("<DesktopAccountMenu email={email} name={name} />");
    expect(sheetSrc).toContain('data-user-menu-desktop=""');
    expect(sheetSrc).toContain("hidden md:block");
    expect(sheetSrc).toContain("ACCOUNT_SHEET_ITEMS");
    expect(sheetSrc).toContain("<AccountMenuDropdown");
    expect(sheetSrc).toContain("<AccountSheet");
    expect(sheetSrc).toContain("586:768");
    expect(sheetSrc).toContain("537:557");
    expect(menuSrc).not.toContain("data-account-sheet-close");
    expect(menuSrc).not.toContain("data-mobile-nav-sheet");
  });
});

describe("UserMenu identity source lock", () => {
  it("does not manufacture a name in the shell or layout", () => {
    const layoutSrc = readFileSync(join(here, "../../app/(app)/layout.tsx"), "utf8");
    expect(layoutSrc).toContain("email={ctx.user.email}");
    expect(layoutSrc).toContain("name={ctx.user.name}");
    expect(layoutSrc).not.toContain("display_name");
    expect(layoutSrc).not.toContain("user_metadata");
    expect(layoutSrc).not.toContain("full_name");
    expect(menuSrc).not.toContain("split(\"@\")");
    expect(menuSrc).not.toContain("local-part");
    expect(menuSrc).not.toContain("user_metadata");
  });
});

describe("UserMenu item lock (source)", () => {
  it("renders the shared USER_MENU_ACTIONS list on both instances — Appearance opens the nested face", () => {
    expect(sheetSrc).toContain("ACCOUNT_SHEET_ITEMS.map");
    expect(sheetSrc).toContain("DesktopAccountMenu");
    expect(sheetSrc).toContain("MobileAccountMenu");
    expect(sheetSrc).toContain('data-user-menu-item="logOut"');
    expect(sheetSrc).toContain('setFace("appearance")');
    expect(sheetSrc).not.toContain("onUserMenuAppearance");
    expect(sheetSrc).not.toContain("toggleDocumentTheme");
    expect(sheetSrc).not.toContain("ThemeGlyph");
    expect(sheetSrc).not.toContain("/account/appearance");
    expect(sheetSrc).not.toContain("type=\"radio\"");
    for (const absent of USER_MENU_ABSENT) {
      expect(sheetSrc).not.toContain(absent);
    }
    expect(sheetSrc).not.toContain("/account/profile");
    expect(sheetSrc).not.toContain("/account/company");
  });

  it("keeps Profile on /settings/profile and Appearance off any page door", () => {
    expect(USER_MENU.profileHref).toBe("/settings/profile");
    expect(USER_MENU.profile).toBe("Profile");
    expect(USER_MENU.agreementsHref).toBe("/settings/agreements");
    expect(USER_MENU.helpHref).toBe("/help");
    expect(USER_MENU.referHref).toBe("/settings/refer");
    expect(USER_MENU).not.toHaveProperty("appearanceHref");
    expect(USER_MENU).not.toHaveProperty("companyProfileHref");
    expect(USER_MENU.appearance).toBe("Appearance");
    expect(APPEARANCE.back).toBe("Back");
    expect(APPEARANCE.back).not.toBe("Back to main menu");
  });

  it("desktop panel items are the same list as mobile", () => {
    expect(USER_MENU_ACTIONS.map((item) => item.label)).toEqual([
      "Profile",
      "Agreements",
      "Appearance",
      "Help",
      "Refer a friend",
    ]);
    expect(sheetSrc).toContain("ACCOUNT_SHEET_ITEMS.map");
    expect(sheetSrc.indexOf("DesktopAccountMenu")).toBeGreaterThan(-1);
    expect(sheetSrc.indexOf("MobileAccountMenu")).toBeGreaterThan(-1);
    expect(sheetSrc).toContain("<AccountSheet");
    expect(sheetSrc).toContain("<AccountMenuDropdown");
  });
});

describe("UserMenu actions", () => {
  beforeEach(() => {
    vi.mocked(signOut).mockClear();
  });

  it("Log out calls the existing signOut action", () => {
    onUserMenuLogOut();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(sheetSrc).toContain("void signOut()");
    expect(sheetSrc).toContain('from "@/app/actions"');
  });

  it("puts the Identity half-bar on the main face only", () => {
    expect(sheetSrc).toContain("<MenuSurfaceAccent");
    expect(sheetSrc).toContain('{face === "main" ? <MenuSurfaceAccent /> : null}');
    expect(sheetSrc).not.toContain("Adam Carpenter");
    expect(sheetSrc).not.toContain("admin@ccbfg.com");
  });

  it("nests Light, Dark, Auto as the same rows — selected is a quiet check", () => {
    expect(sheetSrc).toContain('data-account-menu-face={face}');
    expect(sheetSrc).toContain("APPEARANCE.back");
    expect(sheetSrc).toContain("ChevronLeft");
    expect(sheetSrc).toContain("AccountBackChevron");
    expect(sheetSrc).toContain("APPEARANCE_OPTIONS.map");
    expect(sheetSrc).toContain("AppearanceCheck");
    expect(sheetSrc).toContain("applyDocumentThemePreference");
    expect(sheetSrc).toContain('setFace("appearance")');
    expect(sheetSrc).not.toContain("Back to main menu");
    expect(sheetSrc).not.toContain('type="radio"');
    expect(sheetSrc).not.toContain("radiogroup");
    expect(sheetSrc).not.toContain("ThemeGlyph");
    expect(sheetSrc).not.toContain("/account/appearance");
    expect(APPEARANCE.back).toBe("Back");
    expect(APPEARANCE.light).toBe("Light");
    expect(APPEARANCE.dark).toBe("Dark");
    expect(APPEARANCE.auto).toBe("Auto");
  });
});

describe("UserMenu Mercury quiet craft", () => {
  it("does not restore a standalone header sun", () => {
    const shellSrc = readFileSync(join(here, "app-shell.tsx"), "utf8");
    expect(shellSrc).not.toContain("ThemeToggle");
    expect(shellSrc).not.toContain("theme-toggle");
    expect(shellSrc).not.toContain("ThemeGlyph");
    expect(menuSrc).not.toContain("ThemeToggle");
    expect(menuSrc).not.toContain("ThemeGlyph");
  });
});
