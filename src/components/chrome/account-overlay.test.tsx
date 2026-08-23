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

import { NAV, GC_NAV, MOBILE_NAV } from "@/lib/nav";
import { ACCOUNT_OVERLAY, ACCOUNT_OVERLAY_ABSENT, ACCOUNT_OVERLAY_ITEMS } from "@/lib/account-overlay";
import { USER_MENU } from "@/lib/user-menu";
import { AccountOverlay, MobileAccountMenu } from "./account-overlay";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "account-overlay.tsx"), "utf8");
const menuSrc = readFileSync(join(here, "user-menu.tsx"), "utf8");
const navSrc = readFileSync(join(here, "mobile-nav.tsx"), "utf8");
const headerSrc = readFileSync(join(here, "messages-app-header.tsx"), "utf8");
const tokens = readFileSync(join(here, "../../app/tokens.css"), "utf8");

function attrClass(html: string, attr: string): string {
  const escaped = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const classThenAttr = html.match(new RegExp(`class="([^"]*)"[^>]*${escaped}`));
  const attrThenClass = html.match(new RegExp(`${escaped}[^>]*class="([^"]*)"`));
  return classThenAttr?.[1] ?? attrThenClass?.[1] ?? "";
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

function renderOverlay(email = "ada@example.com", name?: string | null): string {
  return renderToStaticMarkup(
    <AccountOverlay email={email} name={name} pathname="/" onClose={() => undefined} />,
  );
}

describe("MobileAccountMenu trigger", () => {
  it("is the existing 32 avatar, phone-only, and does not open the nav sheet", () => {
    navigation.pathname = "/";
    const html = renderToStaticMarkup(<MobileAccountMenu email="nina@studio.com" />);

    expect(html).toContain("data-account-overlay-trigger");
    expect(html).toContain(ACCOUNT_OVERLAY.sheet);
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).toContain("md:hidden");
    expect(html).toContain("h-8 w-8");
    expect(html).toContain("rounded-full");
    expect(html).toContain("bg-surface-muted");
    expect(html).toContain(">N<");
    expect(html).not.toContain("data-account-overlay=\"\"");
    expect(html).not.toContain("data-mobile-nav-sheet");
    expect(html).not.toContain("data-mobile-nav-trigger");
    expect(src).toContain("onClick={() => setOpenedOn(pathname)}");
    expect(src).toContain("createPortal");
    expect(src).toContain("document.body");
    expect(src).not.toContain("data-mobile-nav");
  });
});

describe("AccountOverlay 537:557", () => {
  it("is a white panel under the header with a tap-out scrim and 44 muted X", () => {
    const html = renderOverlay();
    const closeClass = buttonClass(html, "data-account-overlay-close");
    const headClass = attrClass(html, "data-account-overlay-head");
    const surfaceClass = attrClass(html, "data-account-overlay-surface");
    const scrimClass = attrClass(html, "data-account-overlay-scrim");

    expect(html).toContain("data-account-overlay=\"\"");
    expect(html).toContain("data-account-overlay-scrim");
    expect(html).toContain("md:hidden");
    expect(html).toContain('aria-label="Account"');
    expect(scrimClass).toContain("bg-ink/24");
    expect(surfaceClass).toContain("bg-surface");
    expect(surfaceClass).toContain("top-[var(--header-height)]");
    expect(surfaceClass).toContain("gap-[var(--space-12)]");
    expect(surfaceClass).toContain("px-[var(--space-4)]");
    expect(surfaceClass).toContain("pt-[var(--space-6)]");
    expect(surfaceClass).toContain("pb-[var(--space-12)]");
    expect(surfaceClass).not.toContain("rounded-t-[24px]");
    expect(headClass).toContain("justify-end");
    expect(headClass).toContain("h-[44px]");
    expect(closeClass).toContain("rounded-full");
    expect(closeClass).toContain("bg-surface-muted");
    expect(closeClass).toContain("text-ink-3");
    expect(closeClass).toContain("size-[44px]");
    expect(minBoxPx(closeClass, "min-h")).toBeGreaterThanOrEqual(44);
    expect(minBoxPx(closeClass, "min-w")).toBeGreaterThanOrEqual(44);
    expect(src).toContain('<X className="size-4" strokeWidth={1.33} />');
    expect(src).toContain("event.key === \"Escape\"");
    expect(tokens).toMatch(/--header-height:\s*56px;/);
    expect(tokens).toMatch(/--space-12:\s*3rem/);
    expect(tokens).toContain("--accent: #1769ff;");
  });

  it("puts identity first with the existing avatar and dashes when name is empty", () => {
    const html = renderOverlay("ada@example.com");
    const identity = html.slice(
      html.indexOf("data-account-overlay-identity"),
      html.indexOf("data-account-overlay-group"),
    );
    const manageClass = attrClass(html, "data-account-overlay-manage");

    expect(html).toContain("data-account-overlay-avatar");
    expect(html).toContain("data-account-overlay-name");
    expect(html).toContain("data-account-overlay-email");
    expect(identity).toContain(">A<");
    expect(identity).toContain("—");
    expect(identity).toContain("ada@example.com");
    expect(identity).not.toContain("Ada Lovelace");
    expect(html).toContain(ACCOUNT_OVERLAY.manage);
    expect(html).toContain(`href="${ACCOUNT_OVERLAY.manageHref}"`);
    expect(manageClass).toContain("t-body-sm");
    expect(manageClass).toContain("text-accent");
    expect(manageClass).not.toContain("bg-accent");
    expect(src).toContain("t-body-sm font-normal text-accent");
    expect(src).toContain("accountOverlayIdentity");
    expect(html.indexOf("data-account-overlay-identity")).toBeLessThan(
      html.indexOf("data-account-overlay-group"),
    );
  });

  it("does not invent a name from the email local-part", () => {
    const html = renderOverlay("jane.doe@studio.com");
    expect(html).toContain("jane.doe@studio.com");
    expect(html).not.toContain("Jane Doe");
    expect(html).toContain("data-account-overlay-name");
    const nameHtml = html.slice(
      html.indexOf("data-account-overlay-name"),
      html.indexOf("data-account-overlay-email"),
    );
    expect(nameHtml).toContain("—");
    expect(nameHtml).not.toContain("jane.doe");
  });

  it("shows a real name only when one is already passed", () => {
    const html = renderOverlay("ada@example.com", "Ada Lovelace");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
  });

  it("lists ACCOUNT then User Profile, Company Profile, Agreements — existing routes only", () => {
    const html = renderOverlay();
    const group = html.slice(html.indexOf("data-account-overlay-group"));

    expect(html).toContain(ACCOUNT_OVERLAY.group);
    expect(attrClass(html, "data-account-overlay-group-label")).toContain("tracking-[0.08em]");
    expect(attrClass(html, "data-account-overlay-group-label")).toContain("uppercase");
    expect(group.indexOf("User Profile")).toBeLessThan(group.indexOf("Company Profile"));
    expect(group.indexOf("Company Profile")).toBeLessThan(group.indexOf("Agreements"));
    expect(html).toContain('data-account-overlay-item="userProfile"');
    expect(html).toContain('data-account-overlay-item="companyProfile"');
    expect(html).toContain('data-account-overlay-item="agreements"');
    expect(html).toContain(`href="${ACCOUNT_OVERLAY.manageHref}"`);
    expect(html).toContain(`href="${USER_MENU.agreementsHref}"`);
    expect(html).not.toContain('href="/account/company"');
    expect(html).not.toContain('href="/account/profile"');
    expect(html).not.toContain("/settings");
    expect(ACCOUNT_OVERLAY_ITEMS[1]?.href).toBeNull();
  });

  it("does not dump the rail, Ask Globee chrome, or Adobe leftovers", () => {
    const html = renderOverlay();
    for (const item of [...NAV, ...GC_NAV]) {
      expect(html).not.toContain(item.label);
      if (item.href !== "/") expect(html).not.toContain(`href="${item.href}"`);
    }
    for (const absent of ACCOUNT_OVERLAY_ABSENT) {
      expect(html).not.toContain(absent);
    }
    expect(html).not.toContain(MOBILE_NAV.sheet);
    expect(html).not.toContain("data-mobile-nav-sheet");
    expect(html).not.toContain("data-ask-globee");
    expect(html).not.toContain("MoreHorizontal");
    expect(html).not.toContain("grid-cols");
    expect(html).not.toContain("credits");
    expect(src).not.toContain("ThemeGlyph");
    expect(src).not.toContain("onUserMenuAppearance");
    expect(src).not.toContain("onUserMenuLogOut");
  });

  it("does not restyle Ask Globee 531:542 or the hamburger sheet", () => {
    expect(headerSrc).toContain("531:542");
    expect(headerSrc).not.toContain("537:557");
    expect(headerSrc).not.toContain("account-overlay");
    expect(navSrc).toContain("data-mobile-nav-sheet");
    expect(navSrc).not.toContain("ACCOUNT");
    expect(navSrc).not.toContain("Manage account");
    expect(navSrc).not.toContain("User Profile");
    expect(navSrc).not.toContain("Company Profile");
    expect(menuSrc).toContain("MobileAccountMenu");
    expect(menuSrc).toContain("hidden md:block");
    expect(src).not.toContain("531:542");
  });
});
