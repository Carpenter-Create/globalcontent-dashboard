import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { NAV } from "@/lib/nav";

const navSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "side-nav.tsx"), "utf8");

describe("SideNav Access rail", () => {
  it("keeps the locked client destinations", () => {
    expect(NAV.map((item) => item.label)).toEqual([
      "Dashboard",
      "Titles",
      "Deliveries",
      "Catalog Health",
      "Messages",
    ]);
    expect(NAV.map((item) => item.href)).toEqual([
      "/",
      "/titles",
      "/deliveries",
      "/catalog-health",
      "/messages",
    ]);
  });

  it("uses 15px labels, 16px Lucide at 1.33, and an 8px item gap", () => {
    expect(navSrc).toContain("t-body leading-4");
    expect(navSrc).toContain("size-4 shrink-0");
    expect(navSrc).toContain("strokeWidth={1.33}");
    expect(navSrc).toContain('flex flex-col gap-2');
    expect(navSrc).toContain('collapsed ? "px-1.5" : "px-3"');
    expect(navSrc).not.toContain("t-body-sm font-medium leading-5");
    expect(navSrc).not.toContain("strokeWidth={1.5}");
  });

  it("marks the active item with a muted grey wash, not faded blue", () => {
    expect(navSrc).toContain("bg-surface-muted font-medium text-ink");
    expect(navSrc).toContain("font-normal text-ink-2 hover:bg-surface-muted hover:text-ink");
    expect(navSrc).not.toContain('active ? "bg-surface text-ink"');
    expect(navSrc).not.toMatch(/active\s*\?\s*"[^"]*accent/);
    expect(navSrc).not.toMatch(/active\s*\?\s*"[^"]*blue/);
  });
});
