import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { USER_MENU, USER_MENU_ABSENT } from "@/lib/user-menu";
import { toggleDocumentTheme } from "@/lib/theme";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/actions", () => ({ signOut: vi.fn() }));

import { signOut } from "@/app/actions";
import { onUserMenuAppearance, onUserMenuLogOut, UserMenu, UserMenuIdentity } from "./user-menu";

const menuSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "user-menu.tsx"), "utf8");

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
    expect(menuSrc).toContain("USER_MENU.appearance");
    expect(menuSrc).toContain("USER_MENU.logOut");
    expect(menuSrc).not.toContain("data-account-sheet-close");
    expect(menuSrc).not.toContain("data-mobile-nav-sheet");
  });
});

describe("UserMenu identity source lock", () => {
  it("does not manufacture a name in the shell or layout", () => {
    const layoutSrc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/(app)/layout.tsx"),
      "utf8",
    );
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
  it("contains User Profile, Company Profile, Agreements, Appearance, and Log out", () => {
    expect(menuSrc).toContain("USER_MENU.userProfile");
    expect(menuSrc).toContain("USER_MENU.userProfileHref");
    expect(menuSrc).toContain("USER_MENU.companyProfile");
    expect(menuSrc).toContain("USER_MENU.companyProfileHref");
    expect(menuSrc).toContain("USER_MENU.agreements");
    expect(menuSrc).toContain("USER_MENU.agreementsHref");
    expect(menuSrc).toContain("USER_MENU.appearance");
    expect(menuSrc).toContain("USER_MENU.logOut");
    expect(menuSrc).toContain("onUserMenuAppearance");
    expect(menuSrc).toContain("onUserMenuLogOut");
    for (const absent of USER_MENU_ABSENT) {
      expect(menuSrc).not.toContain(absent);
    }
    expect(menuSrc).not.toContain("/account/profile");
    expect(menuSrc).not.toContain("/settings");
    expect(menuSrc).not.toContain("lucide-react");
  });

  it("keeps User Profile on /account and Company Profile on /account/company", () => {
    expect(USER_MENU.userProfileHref).toBe("/account");
    expect(USER_MENU.userProfile).toBe("User Profile");
    expect(USER_MENU.companyProfileHref).toBe("/account/company");
    expect(USER_MENU.agreementsHref).toBe("/account/agreements");
    expect(menuSrc).toContain("USER_MENU.userProfileHref");
    expect(menuSrc).toContain('data-user-menu-item="userProfile"');
    expect(menuSrc).toContain("USER_MENU.companyProfileHref");
    expect(menuSrc).toContain('data-user-menu-item="companyProfile"');
    expect(menuSrc).toContain("USER_MENU.agreementsHref");
    expect(menuSrc).toContain('data-user-menu-item="agreements"');
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

  it("Appearance reuses the existing theme toggle", () => {
    expect(onUserMenuAppearance).toBe(toggleDocumentTheme);
    expect(menuSrc).toContain("onUserMenuAppearance()");
    expect(menuSrc).toContain("event.preventDefault()");
    expect(menuSrc).toContain("ThemeGlyph");
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
    const userProfile = menuSrc.indexOf('data-user-menu-item="userProfile"');
    const companyProfile = menuSrc.indexOf('data-user-menu-item="companyProfile"');
    const agreements = menuSrc.indexOf('data-user-menu-item="agreements"');
    const appearance = menuSrc.indexOf('data-user-menu-item="appearance"');
    const logoutRule = menuSrc.indexOf('data-user-menu-logout-hairline=""');
    const logOut = menuSrc.indexOf('data-user-menu-item="logOut"');
    expect(hairline).toBeGreaterThan(-1);
    expect(userProfile).toBeGreaterThan(hairline);
    expect(companyProfile).toBeGreaterThan(userProfile);
    expect(agreements).toBeGreaterThan(companyProfile);
    expect(appearance).toBeGreaterThan(agreements);
    expect(logoutRule).toBeGreaterThan(appearance);
    expect(logOut).toBeGreaterThan(logoutRule);
  });

  it("does not restore a standalone header sun", () => {
    const shellSrc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "app-shell.tsx"),
      "utf8",
    );
    expect(shellSrc).not.toContain("ThemeToggle");
    expect(shellSrc).not.toContain("theme-toggle");
    expect(shellSrc).not.toContain("ThemeGlyph");
    expect(menuSrc).not.toContain("ThemeToggle");
    expect(menuSrc).toContain("ThemeGlyph");
  });
});
