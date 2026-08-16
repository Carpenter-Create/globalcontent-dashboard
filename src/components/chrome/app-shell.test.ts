import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
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
    createElement(AppShell, {
      email: "ada@example.com",
      orgs: [{ id: "org-1", name: "Acme" }],
      activeOrgId: "org-1",
      messagesUnread: Promise.resolve(0),
      children: "page",
    }),
  );
}

describe("AppShell header", () => {
  it("no longer mounts a standalone sun or theme toggle", () => {
    const html = renderShell();
    expect(html).toContain("data-user-menu-host");
    expect(html).not.toContain("Switch to dark mode");
    expect(html).not.toContain("Switch to light mode");
    expect(html).not.toContain("theme-toggle");
    expect(html).not.toContain("ThemeToggle");
    expect(shellSrc).not.toContain("ThemeToggle");
    expect(shellSrc).not.toContain("theme-toggle");
    expect(shellSrc).not.toContain("ThemeGlyph");
  });

  it("keeps the account menu in the header", () => {
    const html = renderShell();
    expect(html).toContain('data-email="ada@example.com"');
    expect(shellSrc).toContain("<UserMenu email={email} />");
  });
});
