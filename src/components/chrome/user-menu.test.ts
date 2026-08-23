import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { USER_MENU, USER_MENU_ABSENT } from "@/lib/user-menu";
import { setDocumentThemePreference } from "@/lib/theme";

vi.mock("@/app/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/theme", async () => {
  const actual = await vi.importActual<typeof import("@/lib/theme")>("@/lib/theme");
  return { ...actual, setDocumentThemePreference: vi.fn() };
});

import { signOut } from "@/app/actions";
import {
  onUserMenuAppearanceSelect,
  onUserMenuLogOut,
  UserMenu,
  UserMenuIdentity,
} from "./user-menu";

const menuSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "user-menu.tsx"), "utf8");

function visibleText(html: string): string {
  return html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
}

describe("UserMenuIdentity", () => {
  it("renders a vertical stack: avatar above email, and omits a name when none is provided", () => {
    const html = renderToStaticMarkup(
      createElement(UserMenuIdentity, { email: "ada@example.com" }),
    );
    expect(html).toContain('data-user-menu-identity=""');
    expect(html).toContain("flex flex-col items-center");
    expect(html).toContain("text-center");
    expect(html).toContain('data-user-menu-avatar=""');
    expect(html).toContain('data-user-menu-email=""');
    expect(html).toContain("ada@example.com");
    expect(html).toContain(">A<");
    expect(html).toContain("px-[var(--space-4)] py-[var(--space-4)]");
    expect(html).toContain("t-body-sm text-ink-3");
    expect(html).not.toContain("data-user-menu-name");
    expect(html.indexOf("data-user-menu-avatar")).toBeLessThan(html.indexOf("data-user-menu-email"));
    expect(visibleText(html)).not.toMatch(/Profile|Notifications|Security|Perks/);
  });

  it("renders a name only when a real display name is passed, still above the email", () => {
    const html = renderToStaticMarkup(
      createElement(UserMenuIdentity, { email: "ada@example.com", name: "Ada Lovelace" }),
    );
    expect(html).toContain('data-user-menu-name=""');
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("t-body-sm font-medium text-ink");
    expect(html).toContain("t-body-sm text-ink-3");
    expect(html).not.toContain("t-body font-medium");
    expect(html.indexOf("data-user-menu-avatar")).toBeLessThan(html.indexOf("data-user-menu-name"));
    expect(html.indexOf("data-user-menu-name")).toBeLessThan(html.indexOf("data-user-menu-email"));
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
});

describe("UserMenu identity source lock", () => {
  it("does not manufacture a name in the shell or layout", () => {
    const layoutSrc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/(app)/layout.tsx"),
      "utf8",
    );
    const authSrc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../lib/supabase/auth.ts"),
      "utf8",
    );
    expect(layoutSrc).toContain("email={ctx.user.email}");
    expect(layoutSrc).toContain("name={ctx.user.name}");
    expect(layoutSrc).not.toContain("display_name");
    expect(layoutSrc).not.toContain("user_metadata");
    expect(layoutSrc).not.toContain("full_name");
    expect(authSrc).toContain("resolveAuthUserName");
    expect(menuSrc).not.toContain("split(\"@\")");
    expect(menuSrc).not.toContain("local-part");
    expect(menuSrc).not.toContain("user_metadata");
  });
});

describe("UserMenu item lock (source)", () => {
  it("contains only Agreements, Privacy, Appearance, and Log out", () => {
    expect(menuSrc).toContain("USER_MENU.agreements");
    expect(menuSrc).toContain("USER_MENU.agreementsHref");
    expect(menuSrc).toContain("USER_MENU.privacy");
    expect(menuSrc).toContain("USER_MENU.privacyHref");
    expect(menuSrc).toContain("USER_MENU.appearance");
    expect(menuSrc).toContain("USER_MENU.logOut");
    expect(menuSrc).toContain("onUserMenuAppearanceSelect");
    expect(menuSrc).toContain("onUserMenuLogOut");
    expect(menuSrc).toContain("DropdownMenuSub");
    for (const absent of USER_MENU_ABSENT) {
      expect(menuSrc).not.toContain(absent);
    }
    expect(menuSrc).not.toContain("/account/profile");
    expect(menuSrc).not.toContain("/settings");
    expect(menuSrc).not.toContain("lucide-react");
    expect(menuSrc).not.toContain("ThemeGlyph");
    expect(menuSrc).not.toContain("toggleDocumentTheme");
    expect(menuSrc).not.toContain("onUserMenuAppearance()");
  });

  it("keeps Agreements on the existing href and Privacy as an external link", () => {
    expect(USER_MENU.agreementsHref).toBe("/account/agreements");
    expect(USER_MENU.privacyHref).toBe("https://globalcontent.co/legal/privacy");
    expect(menuSrc).toContain("USER_MENU.agreementsHref");
    expect(menuSrc).toContain('data-user-menu-item="agreements"');
    expect(menuSrc).toContain('data-user-menu-item="privacy"');
    expect(menuSrc).toContain('target="_blank"');
    expect(menuSrc).toContain('rel="noopener noreferrer"');
  });
});

describe("UserMenu actions", () => {
  beforeEach(() => {
    vi.mocked(signOut).mockClear();
    vi.mocked(setDocumentThemePreference).mockClear();
  });

  it("Log out calls the existing signOut action", () => {
    onUserMenuLogOut();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(menuSrc).toContain("onSelect={() => onUserMenuLogOut()}");
    expect(menuSrc).toContain('from "@/app/actions"');
  });

  it("Appearance writes the stored three-way preference", () => {
    onUserMenuAppearanceSelect("system");
    expect(setDocumentThemePreference).toHaveBeenCalledWith("system");
    expect(menuSrc).toContain("onUserMenuAppearanceSelect(option.preference)");
    expect(menuSrc).toContain("userMenuAppearanceLabel");
    expect(menuSrc).toContain("data-user-menu-appearance-submenu");
  });
});

describe("UserMenu Mercury quiet craft", () => {
  it("uses house type and air, not the default shadcn item padding", () => {
    expect(menuSrc).toContain("t-body-sm font-medium text-ink");
    expect(menuSrc).toContain("t-body-sm text-ink-3");
    expect(menuSrc).toContain("px-[var(--space-4)] py-[var(--space-4)]");
    expect(menuSrc).toContain("p-[var(--space-2)]");
    expect(menuSrc).toContain(
      "px-[var(--space-3)] py-[var(--space-2)] t-body-sm text-ink-2",
    );
    expect(menuSrc).toContain("rounded-[var(--radius)]");
    expect(menuSrc).not.toContain("px-2.5 py-1.5");
    expect(menuSrc).not.toContain("p-[var(--space-1)]");
    expect(menuSrc).not.toContain("t-body font-medium");
  });

  it("places one hairline above Appearance and none before Log out", () => {
    const agreements = menuSrc.indexOf('data-user-menu-item="agreements"');
    const privacy = menuSrc.indexOf('data-user-menu-item="privacy"');
    const hairline = menuSrc.indexOf('data-user-menu-hairline=""');
    const appearance = menuSrc.indexOf('data-user-menu-item="appearance"');
    const logOut = menuSrc.indexOf('data-user-menu-item="logOut"');
    expect(agreements).toBeGreaterThan(-1);
    expect(privacy).toBeGreaterThan(agreements);
    expect(hairline).toBeGreaterThan(privacy);
    expect(appearance).toBeGreaterThan(hairline);
    expect(logOut).toBeGreaterThan(appearance);
    expect(menuSrc).not.toContain("data-user-menu-logout-hairline");
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
    expect(menuSrc).not.toContain("ThemeGlyph");
  });
});

describe("UserMenu appearance submenu (source)", () => {
  it("shows the stored-preference subtitle and the three options", () => {
    expect(menuSrc).toContain("userMenuAppearanceLabel");
    expect(menuSrc).toContain("USER_MENU_APPEARANCE_OPTIONS");
    expect(menuSrc).toContain('data-user-menu-appearance-value=""');
    expect(menuSrc).toContain('data-user-menu-appearance-option={option.preference}');
    expect(menuSrc).toContain("data-user-menu-appearance-checked");
    expect(menuSrc).toContain("option.hint");
    expect(menuSrc).toContain("CheckGlyph");
    expect(menuSrc).toContain("ChevronGlyph");
    expect(menuSrc).not.toContain("ThemeGlyph");
    expect(USER_MENU.appearanceLight).toBe("Light mode");
    expect(USER_MENU.appearanceDark).toBe("Dark mode");
    expect(USER_MENU.appearanceSystem).toBe("System default");
    expect(USER_MENU.appearanceSystemHint).toBe("We'll match your system preferences.");
  });
});
