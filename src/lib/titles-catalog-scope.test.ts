import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { NAV, GC_NAV } from "@/lib/nav";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const OTHER_PAGES = [
  "src/app/(app)/page.tsx",
  "src/app/(app)/deliveries/page.tsx",
  "src/app/(app)/catalog-health/page.tsx",
  "src/app/(app)/messages/page.tsx",
  "src/app/(app)/(operator)/gc/titles/[id]/page.tsx",
  "src/app/(app)/titles/[id]/page.tsx",
  "src/components/dashboard/dashboard-home.tsx",
  "src/components/ui/card.tsx",
  "src/components/layout/data-table.tsx",
  "src/components/layout/banner-card.tsx",
] as const;

describe("titles catalog scope", () => {
  it("keeps desktop catalog search on /titles and mobile search in the /titles header", () => {
    const catalogPage = src("src/app/(app)/titles/page.tsx");
    const homePage = src("src/app/(app)/page.tsx");
    const shell = src("src/components/chrome/app-shell.tsx");
    const headerSearch = src("src/components/titles/titles-header-search.tsx");
    const searchField = src("src/components/layout/search-field.tsx");
    const messagesPage = src("src/app/(app)/messages/page.tsx");
    const accessGate = src("src/components/messages/access-upgrade-gate.tsx");
    const thread = src("src/components/messages/ask-globee-thread.tsx");
    const landing = src("src/components/messages/ask-globee-landing.tsx");
    const messagesHeader = src("src/components/chrome/messages-app-header.tsx");
    const titleDetail = src("src/app/(app)/titles/[id]/page.tsx");

    expect(catalogPage).toContain("SearchField");
    expect(catalogPage).toContain("TITLES_CATALOG.searchPlaceholder");
    expect(catalogPage).toContain("max-md:hidden");
    expect(searchField).toContain("Search titles...");
    expect(headerSearch).toContain("SearchField");
    expect(headerSearch).toContain("md:hidden");
    expect(headerSearch).toContain("data-titles-header-search");
    expect(shell).toContain("TitlesHeaderSearch");
    expect(shell).toContain("titlesBleed ? <TitlesHeaderSearch");
    expect(shell).not.toContain("SearchField");
    expect(shell).not.toContain("Search titles");
    expect(shell).not.toMatch(/⌘K|CommandK|command-k/i);
    expect(homePage).not.toContain("SearchField");
    expect(homePage).not.toContain("TitlesHeaderSearch");
    expect(homePage).not.toContain("AddTitleButton");
    expect(titleDetail).not.toContain("SearchField");
    expect(titleDetail).not.toContain("TitlesHeaderSearch");
    expect(titleDetail).not.toContain("AddTitleButton");
    expect(titleDetail).not.toContain("data-add-title");
    expect(messagesPage).not.toContain("SearchField");
    expect(accessGate).not.toContain("SearchField");
    expect(thread).not.toContain("SearchField");
    expect(landing).not.toContain("SearchField");
    expect(messagesHeader).toContain("SearchField");
    expect(messagesHeader).toContain("access-gate");
  });

  it("does not restyle shared primitives or other pages", () => {
    for (const file of OTHER_PAGES) {
      const contents = src(file);
      expect(contents).not.toContain("titles-catalog");
      expect(contents).not.toContain("@/lib/titles-catalog");
      expect(contents).not.toContain("@/components/titles/titles-catalog");
    }
  });

  it("keeps the mobile rail 16 inset on the /titles frame, not a -mx-4 cancel", () => {
    const catalog = src("src/components/titles/titles-catalog.tsx");
    const home = src("src/components/dashboard/dashboard-home.tsx");
    const titleDetail = src("src/app/(app)/titles/[id]/page.tsx");
    const homePage = src("src/app/(app)/page.tsx");

    expect(catalog).toContain("px-[var(--space-4)]");
    expect(catalog).toContain("titles-catalog-rail");
    expect(catalog).not.toContain("-mx-[var(--space-4)]");
    expect(home).not.toContain("titles-catalog-rail");
    expect(home).not.toContain("-mx-[var(--space-4)]");
    expect(titleDetail).not.toContain("titles-catalog");
    expect(titleDetail).not.toContain("-mx-[var(--space-4)]");
    expect(homePage).not.toContain("titles-catalog");
    expect(homePage).not.toContain("-mx-[var(--space-4)]");
  });

  it("does not add a drafts nav item or move the catalog onto deliveries", () => {
    expect(NAV.filter((item) => item.href === "/titles")).toHaveLength(1);
    expect(NAV.some((item) => /draft/i.test(item.label))).toBe(false);
    expect(NAV.find((item) => item.href === "/deliveries")?.label).toBe("Deliveries");
    expect(GC_NAV.some((item) => item.href === "/titles")).toBe(false);
  });
});
