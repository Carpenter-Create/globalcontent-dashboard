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

  it("opens the bottom sheet from the hamburger and portals it out of the header", () => {
    expect(src).toContain("onClick={() => setOpen(true)}");
    expect(src).toContain("createPortal");
    expect(src).toContain("document.body");
    expect(src).toContain("isGcStaff={isGcStaff}");
    expect(src).toContain("<MobileNavSheet");
    expect(src).toContain("pathname={pathname}");
    expect(src).toContain("onClose={() => setOpen(false)}");
  });
});

describe("MobileNavSheet", () => {
  it("is a full-bleed opaque canvas overlay — nothing from the page shows through", () => {
    const html = renderToStaticMarkup(<MobileNavSheet pathname="/" onClose={() => undefined} />);

    expect(html).toContain("data-mobile-nav-sheet");
    expect(html).toContain("inset-0");
    expect(html).toContain("h-dvh");
    expect(html).toContain("w-full");
    expect(html).toContain("bg-canvas");
    expect(html).toContain("background-color:var(--bg)");
    expect(html).toContain("md:hidden");
    expect(html).not.toContain("bg-canvas/");
    expect(html).not.toContain("bg-surface/");
    expect(html).not.toContain("backdrop-blur");
    expect(html).not.toContain("No vendors yet");
    expect(html).not.toContain("Add vendor");
    expect(html).not.toContain("Credentials are never stored here.");
    expect(html).not.toContain("grid-cols-5");
    expect(html).not.toContain("tab-bar");
    expect(html).not.toContain("data-tab-bar");
    expect(html).not.toContain("data-app-rail");
    expect(src).not.toContain("t-section");
    expect(src).not.toContain("t-title");
    expect(src).not.toContain("clientNavCurrent");
  });

  it("does not restack Dashboard or Vendors as a second large title", () => {
    const dash = renderToStaticMarkup(<MobileNavSheet pathname="/" onClose={() => undefined} />);
    const vendors = renderToStaticMarkup(
      <MobileNavSheet pathname="/vendors" onClose={() => undefined} isGcStaff />,
    );

    expect(dash).not.toContain("t-section");
    expect(dash).not.toContain("t-title");
    expect(vendors).not.toContain("t-section");
    expect(vendors).not.toContain("t-title");
    expect(dash).toContain(`aria-label="${MOBILE_NAV.sheet}"`);
  });

  it("keeps the client sheet on the five client destinations and none of the staff rail", () => {
    const html = renderToStaticMarkup(<MobileNavSheet pathname="/" onClose={() => undefined} />);
    const destStart = html.indexOf("data-mobile-nav-destinations");
    const dest = html.slice(destStart);

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
  });

  it("marks Dashboard current on `/` with the muted wash, not a 24 title", () => {
    const html = renderToStaticMarkup(<MobileNavSheet pathname="/" onClose={() => undefined} />);

    expect(linkClass(html, "/")).toContain("t-body text-ink bg-surface-muted");
    expect(html).not.toContain(`t-section text-ink">${NAV[0].label}`);
    expect(html).toContain(MOBILE_NAV.close);
    expect(html).toContain("data-mobile-nav-close");
    expect(src).toContain("<X className=\"size-4\" strokeWidth={1.33} />");
  });

  it("gives staff /vendors the operator set plus the client five, with Vendors current", () => {
    const html = renderToStaticMarkup(
      <MobileNavSheet pathname="/vendors" onClose={() => undefined} isGcStaff />,
    );
    const destStart = html.indexOf("data-mobile-nav-destinations");
    const dest = html.slice(destStart);

    for (const item of [...NAV, ...GC_NAV]) {
      expect(dest).toContain(item.label);
      expect(dest).toContain(`href="${item.href}"`);
    }
    expect(linkClass(html, "/vendors")).toContain("t-body text-ink bg-surface-muted");
    expect(linkClass(html, "/")).toContain("t-body text-ink hover:bg-surface-muted");
    expect(html).not.toContain("t-section");
  });
});

function linkClass(html: string, href: string): string {
  const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const classThenHref = html.match(new RegExp(`<a class="([^"]*)"[^>]*href="${escaped}"`));
  const hrefThenClass = html.match(new RegExp(`<a href="${escaped}"[^>]*class="([^"]*)"`));
  return classThenHref?.[1] ?? hrefThenClass?.[1] ?? "";
}
