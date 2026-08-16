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
  it("does not restyle shared primitives or other pages", () => {
    for (const file of OTHER_PAGES) {
      const contents = src(file);
      expect(contents).not.toContain("titles-catalog");
      expect(contents).not.toContain("@/lib/titles-catalog");
      expect(contents).not.toContain("@/components/titles/titles-catalog");
    }
  });

  it("does not add a drafts nav item or move the catalog onto deliveries", () => {
    expect(NAV.filter((item) => item.href === "/titles")).toHaveLength(1);
    expect(NAV.some((item) => /draft/i.test(item.label))).toBe(false);
    expect(NAV.find((item) => item.href === "/deliveries")?.label).toBe("Deliveries");
    expect(GC_NAV.some((item) => item.href === "/titles")).toBe(false);
  });
});
