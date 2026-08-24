import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { APPEARANCE } from "@/lib/appearance";
import { THEME_PREFERENCES } from "@/lib/theme";
import { getOrgContext } from "@/lib/supabase/context";
import AppearancePage from "./page";
import { AppearanceForm } from "./appearance-form";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  useRouter: () => ({ refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));

function ctx() {
  return {
    user: { id: "u1", email: "ada@example.com", name: "Ada" },
    rows: [{ role: "account_owner", organizations: { id: "org-1", name: "Acme", status: "active" } }],
    orgs: [{ id: "org-1", name: "Acme" }],
    activeOrg: { id: "org-1", name: "Acme", status: "active" },
    activeRole: "account_owner",
    canOperate: true,
    isGcStaff: false,
    unread: Promise.resolve(0),
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(join(here, "page.tsx"), "utf8");
const formSrc = readFileSync(join(here, "appearance-form.tsx"), "utf8");
const layoutSrc = readFileSync(join(here, "../../../layout.tsx"), "utf8");

describe("AppearancePage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders Light, Dark, and Auto — one selected", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    const html = renderToStaticMarkup(await AppearancePage());
    expect(html).toContain(APPEARANCE.title);
    expect(html).toContain(APPEARANCE.subtitle);
    expect(html).toContain(APPEARANCE.light);
    expect(html).toContain(APPEARANCE.dark);
    expect(html).toContain(APPEARANCE.auto);
    expect(html).toContain('name="appearance"');
    expect(html).toContain('type="radio"');
    expect(html).toContain('value="light"');
    expect(html).toContain('value="dark"');
    expect(html).toContain('value="auto"');
    expect(html).toContain("checked");
    expect(THEME_PREFERENCES).toEqual(["light", "dark", "auto"]);
  });

  it("sends an unauthenticated visitor to login", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    await expect(AppearancePage()).rejects.toThrow("REDIRECT:/login");
  });

  it("is the same /account/appearance page on desktop and mobile — not a menu toggle", () => {
    expect(pageSrc).toContain("AppearanceForm");
    expect(formSrc).toContain("applyDocumentThemePreference");
    expect(formSrc).toContain("useThemePreference");
    expect(formSrc).not.toContain("toggleDocumentTheme");
    expect(formSrc).not.toContain("ThemeGlyph");
    expect(formSrc).not.toContain("phone");
    expect(formSrc).not.toContain("mockup");
    expect(formSrc).not.toContain("app-icon");
    expect(`${pageSrc}${formSrc}`).not.toMatch(/md:hidden|hidden md:|max-md:/);
    expect(APPEARANCE.href).toBe("/account/appearance");
  });

  it("uses the existing theme script and does not invent a theme system", () => {
    expect(layoutSrc).toContain("NO_FLASH_THEME_SCRIPT");
    expect(layoutSrc).toContain("<ThemeSync");
    expect(layoutSrc).not.toContain("next-themes");
    expect(pageSrc).not.toContain("sql");
    expect(formSrc).not.toContain("createClient");
    expect(formSrc).not.toContain("NEXT_PUBLIC_");
  });
});

describe("AppearanceForm", () => {
  it("renders quiet house radios and no Mercury chrome", () => {
    const html = renderToStaticMarkup(<AppearanceForm />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain(`aria-label="${APPEARANCE.title}"`);
    expect(html).toContain("t-body text-ink");
    expect(html).not.toContain("ThemeGlyph");
    expect(html).not.toContain("rounded-t-[16px]");
    expect(html).not.toContain("Mercury");
  });
});
