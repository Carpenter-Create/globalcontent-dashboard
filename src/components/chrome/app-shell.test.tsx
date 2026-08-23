import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/messages/ask-globee-actions", () => ({
  startAskGlobeeConversation: vi.fn(),
  appendAskGlobeeTurn: vi.fn(),
  completeAskGlobeeTurn: vi.fn(),
  setAskGlobeeThumb: vi.fn(),
  renameAskGlobeeConversation: vi.fn(),
  pinAskGlobeeConversation: vi.fn(),
  deleteAskGlobeeConversation: vi.fn(),
}));
vi.mock("./organization-switcher", () => ({
  OrganizationSwitcher: () => createElement("div", { "data-org-switcher": "" }),
}));
vi.mock("./side-nav", () => ({
  SideNav: () => createElement("nav", { "data-side-nav": "" }),
}));
vi.mock("./user-menu", () => ({
  UserMenu: ({ email }: { email: string }) =>
    createElement("div", { "data-user-menu-host": "", "data-email": email }),
}));

import { AppShell } from "./app-shell";
import type { MessagesSurface } from "@/lib/ask-globee";

const shellSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "app-shell.tsx"), "utf8");

function renderShell(messagesSurface?: MessagesSurface): string {
  return renderToStaticMarkup(
    <AppShell
      email="ada@example.com"
      orgs={[{ id: "org-1", name: "Acme" }]}
      activeOrgId="org-1"
      messagesUnread={Promise.resolve(0)}
      messagesSurface={messagesSurface}
    >
      page
    </AppShell>,
  );
}

describe("AppShell header", () => {
  it("no longer mounts a standalone sun or theme toggle", () => {
    navigation.pathname = "/";
    const html = renderShell();
    expect(html).toContain("data-user-menu-host");
    expect(html).not.toContain("Switch to dark mode");
    expect(html).not.toContain("Switch to light mode");
    expect(html).not.toContain("theme-toggle");
    expect(html).not.toContain("ThemeToggle");
    expect(shellSrc).not.toContain("ThemeToggle");
    expect(shellSrc).not.toContain("theme-toggle");
    expect(shellSrc).not.toContain("ThemeGlyph");
    expect(shellSrc).not.toMatch(/bell|⌘K|CommandK|command-k|SearchField/i);
  });

  it("keeps the account menu in the header", () => {
    navigation.pathname = "/";
    const html = renderShell();
    expect(html).toContain('data-email="ada@example.com"');
    expect(shellSrc).toContain("<UserMenu email={email} />");
  });

  it("is avatar-only on every Access route — no org switcher", () => {
    expect(shellSrc).not.toContain("OrganizationSwitcher");
    expect(shellSrc).toContain("justify-end");
    expect(shellSrc).toContain("<UserMenu email={email} />");

    for (const path of ["/", "/titles", "/deliveries", "/catalog-health", "/messages"]) {
      navigation.pathname = path;
      const html = renderShell();
      expect(html).not.toContain("data-org-switcher");
      expect(html).toContain("justify-end");
      expect(html).toContain("data-user-menu-host");
      expect(html).toContain("data-app-header");
      expect(html).toContain("px-[var(--content-inset)]");
    }
  });
});

describe("AppShell Access rail and home frame", () => {
  it("uses a white 220 rail and the locked `/` page pad", () => {
    const tokens = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/tokens.css"),
      "utf8",
    );
    expect(tokens).toMatch(/--sidebar-width:\s*220px;/);
    expect(tokens).toMatch(/--content-inset:\s*48px;/);
    expect(tokens).toMatch(/--header-height:\s*56px;/);
    expect(tokens).not.toMatch(/--sidebar-width:\s*190px;/);

    navigation.pathname = "/";
    const html = renderShell();
    expect(html).toContain("data-app-rail");
    expect(html).toMatch(/<aside class="[^"]*\bbg-surface\b[^"]*" data-app-rail=""/);
    expect(html).not.toMatch(/<aside class="[^"]*bg-surface-muted/);
    expect(html).toContain("data-app-home-frame");
    expect(html).toContain("px-[var(--content-inset)]");
    expect(html).toContain("py-[var(--space-8)]");
    expect(html).not.toContain("px-6 pb-24 pt-8");
    expect(html).not.toContain("Search");
    expect(html).not.toContain("data-org-switcher");
  });

  it("does not restyle the titles bleed or other page frames", () => {
    navigation.pathname = "/titles";
    const titles = renderShell();
    expect(titles).toContain("w-full pb-24");
    expect(titles).not.toContain("data-app-home-frame");
    expect(titles).not.toContain("data-app-messages-frame");
    expect(titles).not.toContain("data-org-switcher");
    expect(titles).not.toContain("Search");

    navigation.pathname = "/deliveries";
    const deliveries = renderShell();
    expect(deliveries).toContain("px-6 pb-24 pt-8");
    expect(deliveries).not.toContain("data-app-home-frame");
    expect(deliveries).not.toContain("data-app-messages-frame");
    expect(deliveries).not.toContain("data-org-switcher");

    navigation.pathname = "/catalog-health";
    const health = renderShell();
    expect(health).toContain("px-6 pb-24 pt-8");
    expect(health).not.toContain("data-app-home-frame");
    expect(health).not.toContain("data-app-messages-frame");
    expect(health).not.toContain("data-org-switcher");
  });

  it("gives `/messages` the 48 inset and restores Search only for the Access gate", () => {
    navigation.pathname = "/messages";
    const inbox = renderShell("staff-inbox");
    expect(inbox).toContain("data-app-messages-frame");
    expect(inbox).toContain("data-app-header-leading");
    expect(inbox).toContain("p-[var(--content-inset)]");
    expect(inbox).not.toContain("data-app-home-frame");
    expect(inbox).not.toContain("data-header-search");
    expect(inbox).not.toContain("⌘K");

    const gate = renderShell("access-gate");
    expect(gate).toContain("data-header-search");
    expect(gate).toContain("⌘K");
    expect(gate).not.toContain("data-header-thread");

    const landing = renderShell("ask-globee-landing");
    expect(landing).not.toContain("data-header-search");
    expect(landing).not.toContain("data-header-thread");
    expect(landing).not.toContain("⌘K");

    const thread = renderShell("ask-globee-thread");
    expect(thread).toContain("data-header-thread");
    expect(thread).not.toContain("data-header-search");
    expect(thread).not.toContain("⌘K");

    navigation.pathname = "/";
    expect(renderShell("access-gate")).not.toContain("data-header-search");
    navigation.pathname = "/titles";
    expect(renderShell("access-gate")).not.toContain("data-header-search");
    expect(shellSrc).not.toContain("SearchField");
  });
});

describe("AppShell client mobile chrome", () => {
  it("hides the persistent rail below the house mobile breakpoint and keeps the desktop rail", () => {
    const tokens = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/tokens.css"),
      "utf8",
    );
    expect(tokens).toMatch(/--sidebar-width:\s*220px;/);
    expect(tokens).toMatch(/--sidebar-width-collapsed:\s*60px;/);
    expect(tokens).toMatch(/@media \(max-width:\s*767px\)/);
    expect(tokens).toMatch(/--sidebar-width:\s*0px;/);
    expect(tokens).toMatch(/--sidebar-width-collapsed:\s*0px;/);

    navigation.pathname = "/";
    const html = renderShell();
    expect(html).toMatch(
      /<aside class="[^"]*\bhidden\b[^"]*\bmd:flex\b[^"]*" data-app-rail=""/,
    );
    expect(html).toContain("data-mobile-nav-trigger");
    expect(html).toContain("Open menu");
    expect(html).not.toContain("data-mobile-nav-sheet");
    expect(html).not.toContain("data-tab-bar");
    expect(shellSrc).toContain("hidden h-dvh flex-col");
    expect(shellSrc).toContain("md:flex");
    expect(shellSrc).toContain("<MobileNav />");
    expect(shellSrc).not.toContain("GC_NAV");
  });

  it("keeps mobile chrome on Ask Globee without restoring Search, and keeps the Access gate", () => {
    navigation.pathname = "/messages";
    const landing = renderShell("ask-globee-landing");
    expect(landing).toContain("data-mobile-nav-trigger");
    expect(landing).toContain("data-app-header");
    expect(landing).not.toContain("data-header-search");
    expect(landing).not.toContain("⌘K");
    expect(landing).toMatch(
      /<aside class="[^"]*\bhidden\b[^"]*\bmd:flex\b[^"]*" data-app-rail=""/,
    );

    const gate = renderShell("access-gate");
    expect(gate).toContain("data-mobile-nav-trigger");
    expect(gate).toContain("data-header-search");
    expect(gate).toContain("⌘K");
  });
});
