import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

import { GC_NAV, MOBILE_NAV, NAV } from "@/lib/nav";
import { MobileNav, MobileNavSheet } from "./mobile-nav";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "mobile-nav.tsx"), "utf8");

describe("MobileNav trigger", () => {
  it("renders a 16px lucide Menu at stroke 1.33 in tertiary ink, phone-only", () => {
    navigation.pathname = "/";
    const html = renderToStaticMarkup(<MobileNav />);

    expect(html).toContain("data-mobile-nav-trigger");
    expect(html).toContain(MOBILE_NAV.open);
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).toContain("text-ink-3");
    expect(html).toContain("md:hidden");
    expect(html).toContain("size-4");
    expect(html).toContain("stroke-width=\"1.33\"");
    expect(html).not.toContain("data-mobile-nav-sheet");
    expect(src).toContain("import { Menu, X } from \"lucide-react\"");
    expect(src).toContain("<Menu className=\"size-4\" strokeWidth={1.33} />");
    expect(src).not.toContain("strokeWidth={1.5}");
    expect(src).not.toContain("size-5");
    expect(src).not.toContain("size-6");
  });

  it("opens the bottom sheet from the hamburger", () => {
    expect(src).toContain("onClick={() => setOpen(true)}");
    expect(src).toContain("{open ? <MobileNavSheet pathname={pathname} onClose={() => setOpen(false)} /> : null}");
  });
});

describe("MobileNavSheet", () => {
  it("is a bottom sheet of the five client destinations and none of the staff rail", () => {
    const html = renderToStaticMarkup(<MobileNavSheet pathname="/" onClose={() => undefined} />);
    const destStart = html.indexOf("data-mobile-nav-destinations");
    const dest = html.slice(destStart);

    expect(html).toContain("data-mobile-nav-sheet");
    expect(html).toContain("bottom-0");
    expect(html).toContain("inset-x-0");
    expect(html).toContain("top-0");
    expect(html).toContain("flex-col");
    expect(html).toContain("bg-canvas");
    expect(html).toContain("md:hidden");
    expect(html).not.toContain("grid-cols-5");
    expect(html).not.toContain("tab-bar");
    expect(html).not.toContain("data-tab-bar");
    expect(html).not.toContain("data-app-rail");
    expect(NAV.map((item) => item.label)).toEqual([
      "Dashboard",
      "Titles",
      "Deliveries",
      "Catalog Health",
      "Messages",
    ]);
    for (const item of NAV) {
      expect(dest).toContain(item.label);
      expect(dest).toContain(`href="${item.href}"`);
    }
    for (const item of GC_NAV) {
      expect(html).not.toContain(item.label);
      expect(html).not.toContain(`href="${item.href}"`);
    }
    expect(src).toContain("NAV.map");
    expect(src).not.toContain("GC_NAV");
    expect(src).not.toContain("isGcStaff");
  });

  it("marks Dashboard current on `/` with the muted wash and a 24 title", () => {
    const html = renderToStaticMarkup(<MobileNavSheet pathname="/" onClose={() => undefined} />);
    const dash = html.slice(html.indexOf('href="/"'), html.indexOf('href="/titles"'));

    expect(html).toContain(`t-section text-ink">${NAV[0].label}`);
    expect(dash).toContain("bg-surface-muted");
    expect(html).toContain(MOBILE_NAV.close);
    expect(html).toContain("data-mobile-nav-close");
    expect(src).toContain("<X className=\"size-4\" strokeWidth={1.33} />");
  });
});
