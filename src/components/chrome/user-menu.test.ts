import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { USER_MENU, USER_MENU_ABSENT } from "@/lib/user-menu";

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
    expect(html).toContain("px-[var(--space-4)] py-[var(--space-4)]");
    expect(html).toContain("t-body-sm text-ink-3");
    expect(html).not.toContain("data-user-menu-name");
    expect(visibleText(html)).not.toMatch(/Profile|Notifications|Privacy/);
  });

  it("renders a name row only when a real display name is passed", () => {
    const html = renderToStaticMarkup(
      createElement(UserMenuIdentity, { email: "ada@example.com", name: "Ada Lovelace" }),
    );
    expect(html).toContain('data-user-menu-name=""');
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("t-body-sm font-medium text-ink");
    expect(html).toContain("t-body-sm text-ink-3");
    expect(html).not.toContain("t-body font-medium");
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
  it("has no sheet-style close X sharing the 16px tap target", () => {
    expect(menuSrc).not.toContain("data-user-menu-close");
    expect(menuSrc).not.toContain("<X ");
    expect(menuSrc).not.toContain("lucide-react");
    expect(menuSrc).not.toContain("data-mobile-nav-close");
  });

  it("opens the mobile 544:561 sheet from the avatar and keeps the desktop leftover", () => {
    expect(menuSrc).toContain("MobileAccountMenu");
    expect(menuSrc).toContain("<MobileAccountMenu email={email} name={name} />");
    expect(menuSrc).toContain('data-user-menu-desktop=""');
    expect(menuSrc).toContain("hidden md:block");
    expect(menuSrc).toContain("USER_MENU_ACTIONS");
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
  it("renders the shared USER_MENU_ACTIONS list — Appearance opens the nested face", () => {
    expect(menuSrc).toContain("USER_MENU_ACTIONS.map");
    expect(sheetSrc).toContain("ACCOUNT_SHEET_ITEMS.map");
    expect(menuSrc).toContain("data-user-menu-item={item.kind}");
    expect(menuSrc).toContain("item.href");
    expect(menuSrc).toContain("onUserMenuLogOut");
    expect(menuSrc).toContain('onFace("appearance")');
    expect(menuSrc).toContain("UserMenuDesktopContent");
    expect(menuSrc).not.toContain("onUserMenuAppearance");
    expect(menuSrc).not.toContain("toggleDocumentTheme");
    expect(menuSrc).not.toContain("ThemeGlyph");
    expect(menuSrc).not.toContain("/account/appearance");
    expect(menuSrc).not.toContain("type=\"radio\"");
    expect(menuSrc).not.toContain("lucide-react");
    for (const absent of USER_MENU_ABSENT) {
      expect(menuSrc).not.toContain(absent);
    }
    expect(menuSrc).not.toContain("/account/profile");
    expect(menuSrc).not.toContain("/settings");
  });

  it("keeps User Profile on /account and Appearance off any page door", () => {
    expect(USER_MENU.userProfileHref).toBe("/account");
    expect(USER_MENU.userProfile).toBe("User Profile");
    expect(USER_MENU.companyProfileHref).toBe("/account/company");
    expect(USER_MENU.agreementsHref).toBe("/account/agreements");
    expect(USER_MENU).not.toHaveProperty("appearanceHref");
    expect(USER_MENU.appearance).toBe("Appearance");
    expect(APPEARANCE.back).toBe("Back to main menu");
  });
});

describe("UserMenu actions", () => {
  beforeEach(() => {
    vi.mocked(signOut).mockClear();
  });

  it("Log out calls the existing signOut action", () => {
    onUserMenuLogOut();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(menuSrc).toContain("onSelect={() => onUserMenuLogOut()}");
    expect(menuSrc).toContain('from "@/app/actions"');
  });

  it("nests Light, Dark, Auto as the same rows — selected is a quiet check", () => {
    expect(menuSrc).toContain('data-account-menu-face="appearance"');
    expect(menuSrc).toContain("APPEARANCE.back");
    expect(menuSrc).toContain("APPEARANCE_OPTIONS.map");
    expect(menuSrc).toContain('data-user-menu-item="back"');
    expect(menuSrc).toContain("AppearanceCheck");
    expect(menuSrc).toContain("applyDocumentThemePreference");
    expect(menuSrc).toContain("event.preventDefault()");
    expect(menuSrc).toContain('if (!open) setFace("main")');
    expect(menuSrc).toContain('onFace("appearance")');
    expect(menuSrc).not.toContain('type="radio"');
    expect(menuSrc).not.toContain("radiogroup");
    expect(menuSrc).not.toContain("ThemeGlyph");
    expect(menuSrc).not.toContain("/account/appearance");
    expect(APPEARANCE.back).toBe("Back to main menu");
    expect(APPEARANCE.light).toBe("Light");
    expect(APPEARANCE.dark).toBe("Dark");
    expect(APPEARANCE.auto).toBe("Auto");
  });
});

describe("UserMenu Mercury quiet craft", () => {
  it("uses house type and air, not the default shadcn item padding", () => {
    expect(menuSrc).toContain("t-body-sm font-medium text-ink");
    expect(menuSrc).toContain("t-body-sm text-ink-3");
    expect(menuSrc).toContain("px-[var(--space-4)] py-[var(--space-4)]");
    expect(menuSrc).toContain("<MenuSurfaceContent");
    expect(menuSrc).toContain("<MenuSurfaceItem");
    expect(menuSrc).toContain("<MenuSurfaceSeparator");
    expect(menuSrc).not.toContain("min-w-[17.5rem]");
    expect(menuSrc).not.toContain("USER_MENU_ITEM_CLASS");
    expect(menuSrc).not.toContain("px-2.5 py-1.5");
    expect(menuSrc).not.toContain("p-[var(--space-1)]");
    expect(menuSrc).not.toContain("t-body font-medium");
  });

  it("keeps the identity hairline and adds a divider before Log out", () => {
    const hairline = menuSrc.indexOf('data-user-menu-hairline=""');
    const actions = menuSrc.indexOf("USER_MENU_ACTIONS.map");
    const logoutRule = menuSrc.indexOf('data-user-menu-logout-hairline=""');
    const logOut = menuSrc.indexOf("onSelect={() => onUserMenuLogOut()}");
    expect(hairline).toBeGreaterThan(-1);
    expect(actions).toBeGreaterThan(hairline);
    expect(logoutRule).toBeGreaterThan(actions);
    expect(logOut).toBeGreaterThan(logoutRule);
  });

  it("does not restore a standalone header sun", () => {
    const shellSrc = readFileSync(join(here, "app-shell.tsx"), "utf8");
    expect(shellSrc).not.toContain("ThemeToggle");
    expect(shellSrc).not.toContain("theme-toggle");
    expect(shellSrc).not.toContain("ThemeGlyph");
    expect(menuSrc).not.toContain("ThemeToggle");
    expect(menuSrc).not.toContain("ThemeGlyph");
  });
});
