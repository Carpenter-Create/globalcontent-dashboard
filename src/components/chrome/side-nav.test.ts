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
      "Ask Globee",
    ]);
    expect(NAV.map((item) => item.href)).toEqual([
      "/",
      "/titles",
      "/deliveries",
      "/catalog-health",
      "/messages",
    ]);
  });

  it("uses 13px labels via --text-sm / t-body-sm, 16px Lucide at 1.33, and an 8px item gap", () => {
    const tokens = readFileSync("src/app/tokens.css", "utf8");
    const globals = readFileSync("src/app/globals.css", "utf8");
    const itemClass = navSrc.match(
      /"relative flex items-center rounded-\[var\(--radius\)\] [^"]+"/,
    )?.[0];
    expect(navSrc).toContain("13px labels (--text-sm / t-body-sm)");
    expect(tokens).toMatch(/--text-sm:\s*0\.8125rem;/);
    expect(globals).toMatch(/\.t-body-sm\s*\{[\s\S]*?font-size:\s*var\(--text-sm\)/);
    expect(itemClass).toContain("t-body-sm leading-4");
    expect(itemClass).not.toContain("text-[0.875rem]");
    expect(itemClass).not.toMatch(/(?:^|[\s"])t-body(?:[\s"]|$)/);
    expect(navSrc).not.toContain("text-[0.875rem]");
    const markSrc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "nav-mark.tsx"),
      "utf8",
    );
    expect(navSrc).toContain("<NavMark item={item} />");
    expect(markSrc).toContain("size-4 shrink-0");
    expect(markSrc).toContain("strokeWidth={1.33}");
    expect(markSrc).toContain("data-ask-globee-nav-mark");
    expect(markSrc).toContain("item.markSrc");
    expect(markSrc).toContain("ASK_GLOBEE_NAV_MARK.fillClass");
    expect(markSrc).not.toContain("ask-globee-16.png");
    expect(markSrc).not.toContain("MessageSquare");
    expect(navSrc).toContain('flex flex-col gap-2');
    expect(navSrc).toContain('collapsed ? "px-1.5" : "px-3"');
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
