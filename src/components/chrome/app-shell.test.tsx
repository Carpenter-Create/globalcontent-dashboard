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
    expect(shellSrc).not.toMatch(/bell|⌘K|CommandK|command-k/i);
  });

  it("keeps the account menu in the header", () => {
    navigation.pathname = "/";
    const html = renderShell();
    expect(html).toContain('data-email="ada@example.com"');
    expect(shellSrc).toContain("<UserMenu email={email} />");
  });

  it("hides the org switcher on client `/` so identity is not duplicated", () => {
    navigation.pathname = "/";
    const html = renderShell();
    expect(html).not.toContain("data-org-switcher");
    expect(html).toContain("justify-end");
    expect(html).toContain("data-user-menu-host");
    expect(shellSrc).toContain('pathname === "/"');
  });

  it("keeps the org switcher on other client routes", () => {
    navigation.pathname = "/catalog-health";
    const html = renderShell();
    expect(html).toContain("data-org-switcher");
    expect(html).toContain("justify-between");
  });
});
