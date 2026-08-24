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

import { GC_NAV, MOBILE_NAV, NAV, type NavItem } from "@/lib/nav";
import { destinationClickClosesSheet, MobileNav, MobileNavSheet } from "./mobile-nav";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "mobile-nav.tsx"), "utf8");
const houseSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "house.tsx"), "utf8");

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
    expect(src).toContain("import { Menu } from \"lucide-react\"");
    expect(src).toContain("<Menu className=\"size-4\" strokeWidth={1.33} />");
    expect(src).toContain("Close44");
    expect(src).not.toContain("strokeWidth={1.5}");
    expect(src).not.toContain("size-5");
    expect(src).not.toContain("size-6");
  });

  it("opens the bottom sheet from the hamburger and portals it out of the header", () => {
    expect(src).toContain("onClick={() => setOpenedOn(pathname)}");
    expect(src).toContain("createPortal");
    expect(src).toContain("document.body");
    expect(src).toContain("isGcStaff={isGcStaff}");
    expect(src).toContain("<MobileNavSheet");
    expect(src).toContain("pathname={pathname}");
    expect(src).toContain("onClose={() => setOpenedOn(null)}");
  });

  it("keeps the opaque portal mounted until the destination route commits", () => {
    expect(src).toContain("const open = openedOn !== null && openedOn === pathname;");
    expect(src).toContain("onClick={() => setOpenedOn(pathname)}");
    expect(src).not.toContain("setOpen(false)");
    expect(src).toContain(
      "onClick={destinationClickClosesSheet(pathname, item.href) ? onClose : undefined}",
    );
    expect(src).not.toContain("href={item.href}\n        onClick={onClose}");
    expect(destinationClickClosesSheet("/", "/")).toBe(true);
    expect(destinationClickClosesSheet("/", "/titles")).toBe(false);
    expect(destinationClickClosesSheet("/titles", "/titles")).toBe(true);
    expect(destinationClickClosesSheet("/titles", "/deliveries")).toBe(false);
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
    expect(src).not.toContain("t-display");
    expect(src).not.toContain("clientNavCurrent");
    expect(html).toContain("data-mobile-nav-surface");
    expect(attrClass(html, "data-mobile-nav-surface")).toContain("rounded-t-[16px]");
    expect(attrClass(html, "data-mobile-nav-surface")).toContain("bg-surface");
    expect(attrClass(html, "data-mobile-nav-surface")).toContain("px-[var(--space-4)]");
    expect(attrClass(html, "data-mobile-nav-sheet")).not.toContain("rounded-t-[16px]");
  });

  it("does not restack Dashboard or Vendors as a second large title", () => {
    const dash = renderToStaticMarkup(<MobileNavSheet pathname="/" onClose={() => undefined} />);
    const vendors = renderToStaticMarkup(
      <MobileNavSheet pathname="/vendors" onClose={() => undefined} isGcStaff />,
    );

    expect(dash).not.toContain("t-section");
    expect(vendors).not.toContain("t-section");
    expect(dash).not.toContain(`t-title text-ink">${NAV[0].label}`);
    expect(vendors).not.toContain(`t-title text-ink">${GC_NAV[2].label}`);
    expect(dash).toContain(`aria-label="${MOBILE_NAV.sheet}"`);
  });

  it("locks the app-sheet header: Menu left, muted 44 X circle right, r16 surface", () => {
    const html = renderToStaticMarkup(<MobileNavSheet pathname="/" onClose={() => undefined} />);
    const tokens = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/tokens.css"),
      "utf8",
    );
    const headerClass = attrClass(html, "data-mobile-nav-header");
    const titleClass = attrClass(html, "data-mobile-nav-title");
    const closeClass = buttonClass(html, "data-mobile-nav-close");
    const titleHtml = html.slice(
      html.indexOf("data-mobile-nav-title"),
      html.indexOf("data-mobile-nav-close"),
    );

    expect(MOBILE_NAV.sheet).toBe("Menu");
    expect(tokens).toMatch(/--text-title:\s*1\.5rem/);
    expect(html).toContain("data-mobile-nav-header");
    expect(headerClass).toContain("justify-between");
    expect(headerClass).toContain("items-center");
    expect(titleClass).toContain("t-title");
    expect(titleClass).toContain("text-ink");
    expect(titleHtml).toContain(MOBILE_NAV.sheet);
    expect(titleHtml).not.toContain("Staff");
    expect(html.indexOf("data-mobile-nav-title")).toBeLessThan(html.indexOf("data-mobile-nav-close"));
    expect(html.indexOf("data-mobile-nav-header")).toBeLessThan(
      html.indexOf("data-mobile-nav-destinations"),
    );
    expect(closeClass).toContain("rounded-full");
    expect(closeClass).toContain("bg-surface-muted");
    expect(closeClass).toContain("items-center");
    expect(closeClass).toContain("justify-center");
    expect(closeClass).not.toContain("bg-accent");
    expect(closeClass).not.toContain("self-start");
    expect(closeClass).not.toContain("items-start");
    expect(closeClass).not.toContain("justify-start");
    expect(src).not.toContain("self-start");
    expect(src).not.toContain("items-start justify-start");
    expect(html).not.toContain("lucide-chevron");
    expect(src).not.toContain("Chevron");
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
      "Ask Globee",
    ]);
    for (const item of NAV) {
      expect(dest).toContain(item.label);
      expect(dest).toContain(`href="${item.href}"`);
    }
    for (const item of GC_NAV) {
      expect(html).not.toContain(item.label);
      expect(html).not.toContain(`href="${item.href}"`);
    }
    expect(html).not.toContain("data-mobile-nav-group-rule");
    expect(html).not.toContain("Global Content");
    expect(html).not.toContain("Staff");
    expect(html).not.toContain("t-label");
  });

  it("marks Dashboard current on `/` with the muted wash, not a 24 title", () => {
    const html = renderToStaticMarkup(<MobileNavSheet pathname="/" onClose={() => undefined} />);
    const tokens = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/tokens.css"),
      "utf8",
    );
    const current = linkHtml(html, "/");
    const currentClass = linkClass(html, "/");

    expect(currentClass).toContain("t-body text-ink bg-surface-muted");
    expect(currentClass).toContain("p-[var(--space-4)]");
    expect(tokens).toMatch(/--space-4:\s*1rem/);
    expect(current).toContain('fill="none"');
    expect(current).toContain('stroke-width="1.33"');
    expect(current).not.toContain('fill="currentColor"');
    expect(current).not.toContain("fill-ink");
    expect(html).not.toContain(`t-section text-ink">${NAV[0].label}`);
    expect(html).not.toContain(`t-title text-ink">${NAV[0].label}`);
    expect(html).toContain(MOBILE_NAV.close);
    expect(html).toContain("data-mobile-nav-close");
    expect(src).toContain("<Close44");
    expect(src).toContain("from \"./house\"");
  });

  it("keeps the close glyph at 16 and expands the tap box to at least 44", () => {
    const html = renderToStaticMarkup(<MobileNavSheet pathname="/" onClose={() => undefined} />);
    const closeClass = buttonClass(html, "data-mobile-nav-close");

    expect(src).toContain("<Close44");
    expect(src).not.toContain("<X className=\"size-5\"");
    expect(src).not.toContain("<X className=\"size-6\"");
    expect(houseSrc).toContain('<X className="size-4" strokeWidth={1.33} />');
    expect(html).toContain("stroke-width=\"1.33\"");
    expect(closeClass).toContain("text-ink-3");
    expect(closeClass).toContain("rounded-full");
    expect(closeClass).toContain("bg-surface-muted");
    expect(closeClass).not.toMatch(/(?:^|[\s"])size-4(?:[\s"]|$)/);
    expect(minBoxPx(closeClass, "min-h")).toBeGreaterThanOrEqual(44);
    expect(minBoxPx(closeClass, "min-w")).toBeGreaterThanOrEqual(44);
  });

  it("uses the desktop rail Lucide marks, 16 / 1.33 stroke, no fill, no section word", () => {
    const html = renderToStaticMarkup(
      <MobileNavSheet pathname="/" onClose={() => undefined} isGcStaff />,
    );
    const destStart = html.indexOf("data-mobile-nav-destinations");
    const dest = html.slice(destStart);

    expect(src).toContain("const Icon = item.icon");
    expect(src).toContain('<Icon className="size-4 shrink-0" strokeWidth={1.33} />');
    expect(src).toContain("flex w-full items-center");
    expect(src).not.toContain("NavMark");
    expect(src).not.toContain("fill=");
    expect(src).not.toContain("fill-current");
    expect(src).not.toContain("strokeWidth={2}");
    expect(html).not.toContain("Global Content");
    expect(html).not.toContain("Staff");
    expect(html).not.toContain("t-label");
    expect(html).not.toContain("lucide-chevron");
    expect(src).not.toContain("Chevron");

    for (const item of [...NAV, ...GC_NAV]) {
      const mark = iconMark(item);
      const row = linkHtml(html, item.href);
      expect(dest).toContain(item.label);
      expect(mark.lucide).not.toBe("");
      expect(row).toContain(mark.lucide);
      expect(row).toContain(mark.svg);
      expect(row).toContain("size-4");
      expect(row).toContain("shrink-0");
      expect(row).toContain('stroke-width="1.33"');
      expect(row).toContain('fill="none"');
      expect(row).not.toContain('fill="currentColor"');
      if (item.href === "/messages") {
        expect(mark.lucide).toBe("lucide-sparkles");
        expect(row).toContain("lucide-sparkles");
        expect(row).not.toContain("lucide-sparkle ");
        expect(row).not.toContain("ask-globee-16.png");
        expect(row).not.toContain("data-ask-globee-nav-mark");
      }
    }
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
    const tokens = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/tokens.css"),
      "utf8",
    );
    expect(tokens).toMatch(/--space-6:\s*1\.5rem/);
    expect(html).toContain("data-mobile-nav-group-rule");
    expect(html).toContain("my-[var(--space-6)]");
    expect(html).toContain("border-t border-hairline");
    expect(html).not.toContain("Global Content");
    expect(html).not.toContain("Staff");
    expect(html).not.toContain("t-label");
    expect(dest.indexOf("Ask Globee")).toBeLessThan(dest.indexOf("data-mobile-nav-group-rule"));
    expect(dest.indexOf("data-mobile-nav-group-rule")).toBeLessThan(dest.indexOf("Queue"));
  });

  it("scrolls the destination list on touch without the overlay eating the swipe", () => {
    const html = renderToStaticMarkup(
      <MobileNavSheet pathname="/" onClose={() => undefined} isGcStaff />,
    );
    const sheetClass = attrClass(html, "data-mobile-nav-sheet");
    const destClass = attrClass(html, "data-mobile-nav-destinations");

    expect(destClass).toContain("overflow-y-auto");
    expect(destClass).toContain("overscroll-contain");
    expect(destClass).toContain("touch-pan-y");
    expect(destClass).toContain("min-h-0");
    expect(destClass).toContain("flex-1");
    expect(html).toContain("-webkit-overflow-scrolling:touch");
    expect(src).toContain('WebkitOverflowScrolling: "touch"');
    expect(sheetClass).toContain("overflow-hidden");
    expect(sheetClass).toContain("touch-none");
    expect(sheetClass).not.toContain("overflow-y-auto");
    expect(src).not.toContain("overflow-y-scroll");
  });
});

function linkClass(html: string, href: string): string {
  const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const classThenHref = html.match(new RegExp(`<a class="([^"]*)"[^>]*href="${escaped}"`));
  const hrefThenClass = html.match(new RegExp(`<a href="${escaped}"[^>]*class="([^"]*)"`));
  return classThenHref?.[1] ?? hrefThenClass?.[1] ?? "";
}

function buttonClass(html: string, attr: string): string {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const classThenAttr = html.match(new RegExp(`<button class="([^"]*)"[^>]*${escaped}`));
  const attrThenClass = html.match(new RegExp(`<button[^>]*${escaped}[^>]*class="([^"]*)"`));
  return classThenAttr?.[1] ?? attrThenClass?.[1] ?? "";
}

function minBoxPx(className: string, prop: "min-h" | "min-w"): number {
  const match = className.match(new RegExp(`${prop}-\\[(\\d+)px\\]`));
  return match ? Number(match[1]) : 0;
}

function attrClass(html: string, attr: string): string {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const classThenAttr = html.match(new RegExp(`class="([^"]*)"[^>]*${escaped}`));
  const attrThenClass = html.match(new RegExp(`${escaped}[^>]*class="([^"]*)"`));
  return classThenAttr?.[1] ?? attrThenClass?.[1] ?? "";
}

function linkHtml(html: string, href: string): string {
  const needle = `href="${href}"`;
  const hrefAt = html.indexOf(needle);
  if (hrefAt < 0) return "";
  const start = html.lastIndexOf("<a", hrefAt);
  const end = html.indexOf("</a>", hrefAt);
  return start >= 0 && end >= 0 ? html.slice(start, end + 4) : "";
}

function iconMark(item: NavItem): { lucide: string; svg: string } {
  const Icon = item.icon;
  const html = renderToStaticMarkup(<Icon className="size-4 shrink-0" strokeWidth={1.33} />);
  return {
    lucide: html.match(/\blucide-[a-z0-9-]+\b/)?.[0] ?? "",
    svg: html,
  };
}
