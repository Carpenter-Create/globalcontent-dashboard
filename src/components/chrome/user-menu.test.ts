import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { USER_MENU, USER_MENU_ABSENT } from "@/lib/user-menu";
import { toggleDocumentTheme } from "@/lib/theme";

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
    expect(html).not.toContain("data-user-menu-name");
    expect(visibleText(html)).not.toMatch(/Profile|Notifications|Privacy/);
  });

  it("renders a name row only when a real display name is passed", () => {
    const html = renderToStaticMarkup(
      createElement(UserMenuIdentity, { email: "ada@example.com", name: "Ada Lovelace" }),
    );
    expect(html).toContain('data-user-menu-name=""');
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("t-body font-medium text-ink");
    expect(html).toContain("t-body-sm text-ink-2");
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

describe("UserMenu identity source lock", () => {
  it("does not manufacture a name in the shell or layout", () => {
    const layoutSrc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/(app)/layout.tsx"),
      "utf8",
    );
    expect(layoutSrc).toContain("email={ctx.user.email}");
    expect(layoutSrc).not.toContain("display_name");
    expect(layoutSrc).not.toContain("user_metadata");
    expect(layoutSrc).not.toContain("full_name");
    expect(menuSrc).not.toContain("split(\"@\")");
    expect(menuSrc).not.toContain("local-part");
    expect(menuSrc).not.toContain("user_metadata");
  });
});

describe("UserMenu item lock (source)", () => {
  it("contains only Agreements, Appearance, and Log out", () => {
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
  });

  it("keeps Agreements on the existing href", () => {
    expect(USER_MENU.agreementsHref).toBe("/account/agreements");
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
