import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
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

const shellSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "app-shell.tsx"), "utf8");

function renderShell(): string {
  return renderToStaticMarkup(
    <AppShell
      email="ada@example.com"
      orgs={[{ id: "org-1", name: "Acme" }]}
      activeOrgId="org-1"
      messagesUnread={Promise.resolve(0)}
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
    expect(titles).not.toContain("data-org-switcher");

    navigation.pathname = "/deliveries";
    const deliveries = renderShell();
    expect(deliveries).toContain("px-6 pb-24 pt-8");
    expect(deliveries).not.toContain("data-app-home-frame");
    expect(deliveries).not.toContain("data-org-switcher");

    navigation.pathname = "/catalog-health";
    const health = renderShell();
    expect(health).toContain("px-6 pb-24 pt-8");
    expect(health).not.toContain("data-app-home-frame");
    expect(health).not.toContain("data-org-switcher");
  });
});
