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
vi.mock("@/app/actions", () => ({ signOut: vi.fn() }));

import { NAV, GC_NAV, MOBILE_NAV } from "@/lib/nav";
import { ACCOUNT_SHEET, ACCOUNT_SHEET_ABSENT, ACCOUNT_SHEET_ITEMS } from "@/lib/account-sheet";
import {
  APP_SHEET_RISE_CLASS,
  APP_SHEET_SCRIM_CLASS,
  APP_SHEET_SCRIM_FADE_CLASS,
  APP_SHEET_SURFACE_CLASS,
  CLOSE_44_CLASS,
  SHEET_GROUP_ITEM_CLASS,
} from "@/lib/house-sheet";
import { USER_MENU } from "@/lib/user-menu";
import { AccountSheet, MobileAccountMenu } from "./account-sheet";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "account-sheet.tsx"), "utf8");
const houseSrc = readFileSync(join(here, "house.tsx"), "utf8");
const menuSrc = readFileSync(join(here, "user-menu.tsx"), "utf8");
const navSrc = readFileSync(join(here, "mobile-nav.tsx"), "utf8");
const headerSrc = readFileSync(join(here, "messages-app-header.tsx"), "utf8");
const landingSrc = readFileSync(join(here, "../messages/ask-globee-landing.tsx"), "utf8");
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

function renderSheet(email = "ada@example.com", name?: string | null): string {
  return renderToStaticMarkup(
    <AccountSheet email={email} name={name} pathname="/" onClose={() => undefined} />,
  );
}

describe("MobileAccountMenu trigger", () => {
  it("is the existing 32 avatar, phone-only, and does not open the nav sheet", () => {
    navigation.pathname = "/";
    const html = renderToStaticMarkup(<MobileAccountMenu email="nina@studio.com" />);

    expect(html).toContain("data-account-sheet-trigger");
    expect(html).toContain(ACCOUNT_SHEET.sheet);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("md:hidden");
    expect(html).toContain("h-8 w-8");
    expect(html).toContain("rounded-full");
    expect(html).toContain("bg-surface-muted");
    expect(html).toContain(">N<");
    expect(html).not.toContain("data-account-sheet=\"\"");
    expect(html).not.toContain("data-mobile-nav-sheet");
    expect(html).not.toContain("data-mobile-nav-trigger");
    expect(src).toContain("onClick={() => setOpenedOn(pathname)}");
    expect(src).toContain("createPortal");
    expect(src).toContain("document.body");
    expect(src).not.toContain("data-mobile-nav");
  });
});

describe("AccountSheet 544:561", () => {
  it("rises from the bottom over a quiet scrim so the page stays under", () => {
    const html = renderSheet();
    const closeClass = buttonClass(html, "data-account-sheet-close");
    const headClass = attrClass(html, "data-account-sheet-head");
    const surfaceClass = attrClass(html, "data-account-sheet-surface");
    const scrimClass = attrClass(html, "data-account-sheet-scrim");
    const hostClass = attrClass(html, "data-account-sheet=\"\"");

    expect(html).toContain("data-account-sheet=\"\"");
    expect(html).toContain("data-account-sheet-scrim");
    expect(html).toContain("md:hidden");
    expect(html).toContain('aria-label="Account"');
    expect(hostClass).toContain("justify-end");
    expect(hostClass).not.toContain("bg-canvas");
    expect(scrimClass).toBe(APP_SHEET_SCRIM_CLASS);
    expect(scrimClass).toContain(APP_SHEET_SCRIM_FADE_CLASS);
    expect(surfaceClass).toContain(APP_SHEET_RISE_CLASS);
    expect(surfaceClass).toContain("rounded-t-[16px]");
    expect(surfaceClass).toContain("bg-surface");
    expect(surfaceClass).toContain("px-[var(--space-4)]");
    expect(surfaceClass).toContain("pt-[var(--space-6)]");
    expect(surfaceClass).toContain("pb-[var(--space-12)]");
    expect(surfaceClass).not.toContain("top-[var(--header-height)]");
    expect(surfaceClass).not.toContain("rounded-t-[24px]");
    expect(APP_SHEET_SURFACE_CLASS.split(" ").every((token) => surfaceClass.includes(token))).toBe(
      true,
    );
    expect(headClass).toContain("justify-end");
    expect(headClass).toContain("h-[44px]");
    expect(closeClass).toContain("rounded-full");
    expect(closeClass).toContain("bg-surface-muted");
    expect(closeClass).toContain("text-ink-3");
    expect(closeClass).toContain("size-[44px]");
    expect(CLOSE_44_CLASS.split(" ").every((token) => closeClass.includes(token))).toBe(true);
    expect(minBoxPx(closeClass, "min-h")).toBeGreaterThanOrEqual(44);
    expect(minBoxPx(closeClass, "min-w")).toBeGreaterThanOrEqual(44);
    expect(src).toContain("<Close44");
    expect(src).toContain("<AppSheetSurface");
    expect(src).not.toMatch(/duration-\d|ease-out|ease-in|@keyframes|bounce/i);
    expect(houseSrc).toContain('<X className="size-4" strokeWidth={1.33} />');
    expect(src).toContain("event.key === \"Escape\"");
    expect(tokens).toMatch(/--space-12:\s*3rem/);
    expect(tokens).toContain("--accent: #1769ff;");
  });

  it("puts Mercury identity first: 48 circle, name 15 ink, email 13 tertiary, then hairline", () => {
    const html = renderSheet("ada@example.com");
    const identity = html.slice(
      html.indexOf("data-identity-block"),
      html.indexOf("data-account-sheet-rule"),
    );
    const userProfileClass = attrClass(html, 'data-sheet-group-item="userProfile"');
    const nameClass = attrClass(html, "data-identity-name");
    const emailClass = attrClass(html, "data-identity-email");

    expect(html).toContain("data-identity-avatar");
    expect(html).toContain("data-identity-name");
    expect(html).toContain("data-identity-email");
    expect(identity).toContain(">A<");
    expect(identity).not.toContain("—");
    expect(identity).toContain("ada@example.com");
    expect(identity).not.toContain("Ada Lovelace");
    expect(identity).not.toContain("Manage account");
    expect(nameClass).toContain("t-body");
    expect(nameClass).toContain("text-ink");
    expect(nameClass).not.toContain("text-accent");
    expect(emailClass).toContain("t-body-sm");
    expect(emailClass).toContain("text-ink-3");
    expect(html).toContain(USER_MENU.userProfile);
    expect(html).toContain(`href="${USER_MENU.userProfileHref}"`);
    expect(userProfileClass).toBe(SHEET_GROUP_ITEM_CLASS);
    expect(src).toContain("<IdentityBlock");
    expect(src).not.toContain("TextAction");
    expect(html.indexOf("data-identity-block")).toBeLessThan(html.indexOf("data-account-sheet-rule"));
    expect(html.indexOf("data-account-sheet-rule")).toBeLessThan(html.indexOf('data-sheet-group-item="userProfile"'));
    expect(html).toContain("data-account-sheet-rule");
    expect(attrClass(html, "data-account-sheet-rule")).toContain("bg-hairline");
  });

  it("does not invent a name from the email local-part or render a dash", () => {
    const html = renderSheet("jane.doe@studio.com");
    expect(html).toContain("jane.doe@studio.com");
    expect(html).not.toContain("Jane Doe");
    expect(html).toContain("data-identity-name");
    expect(html).not.toContain("—");
    expect(html).not.toContain("jane.doe</");
  });

  it("shows a real name only when one is already passed", () => {
    const html = renderSheet("ada@example.com", "Ada Lovelace");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
    expect(html).toContain("data-identity-name");
  });

  it("lists User Profile, Company Profile, Agreements, Appearance, then Log out", () => {
    const html = renderSheet();
    const group = html.slice(html.indexOf("data-sheet-group"));
    const userProfileClass = attrClass(html, 'data-sheet-group-item="userProfile"');
    const companyClass = attrClass(html, 'data-sheet-group-item="companyProfile"');
    const agreementsClass = attrClass(html, 'data-sheet-group-item="agreements"');
    const appearanceClass = attrClass(html, 'data-sheet-group-item="appearance"');
    const logOutClass = attrClass(html, 'data-sheet-group-item="logOut"');

    expect(html).not.toContain("Manage account");
    expect(html).not.toContain("data-sheet-group-label");
    expect(html).not.toContain(">ACCOUNT<");
    expect(group.indexOf("User Profile")).toBeLessThan(group.indexOf("Company Profile"));
    expect(group.indexOf("Company Profile")).toBeLessThan(group.indexOf("Agreements"));
    expect(group.indexOf("Agreements")).toBeLessThan(group.indexOf("Appearance"));
    expect(group.indexOf("Appearance")).toBeLessThan(group.indexOf("Log out"));
    expect(html).toContain('data-sheet-group-item="userProfile"');
    expect(html).toContain('data-sheet-group-item="companyProfile"');
    expect(html).toContain('data-sheet-group-item="agreements"');
    expect(html).toContain('data-sheet-group-item="appearance"');
    expect(html).toContain('data-sheet-group-item="logOut"');
    expect(html).toContain(`href="${USER_MENU.userProfileHref}"`);
    expect(html).toContain(`href="${USER_MENU.companyProfileHref}"`);
    expect(html).toContain(`href="${USER_MENU.agreementsHref}"`);
    expect(html).toContain(`href="${USER_MENU.appearanceHref}"`);
    expect(html).not.toContain('href="/account/profile"');
    expect(html).not.toContain("/settings");
    expect(ACCOUNT_SHEET_ITEMS).toBeDefined();
    expect(src).toContain('from "@/app/actions"');
    expect(src).toContain("void signOut()");
    expect(src).toContain("<SheetGroupItem");
    expect(src).not.toContain("TextAction");
    expect(src).not.toContain("data-account-sheet-manage");
    expect(userProfileClass).toBe(companyClass);
    expect(userProfileClass).toBe(agreementsClass);
    expect(userProfileClass).toBe(appearanceClass);
    expect(userProfileClass).toBe(logOutClass);
    expect(userProfileClass).toBe(SHEET_GROUP_ITEM_CLASS);
    expect(userProfileClass).toContain("text-[length:var(--text-base)]");
    expect(userProfileClass).toContain("font-normal");
    expect(userProfileClass).toContain("text-ink");
    expect(userProfileClass).not.toContain("t-body-sm");
    expect(userProfileClass).not.toContain("text-accent");
    expect(logOutClass).toContain("text-[length:var(--text-base)]");
    expect(logOutClass).toContain("font-normal");
    expect(logOutClass).toContain("text-ink");
    expect(logOutClass).not.toContain("font-medium");
    expect(logOutClass).not.toContain("font-bold");
    expect(logOutClass).not.toContain("text-[#c4564a]");
    expect(logOutClass).not.toContain("text-accent");
  });

  it("does not dump the rail, Ask Globee chrome, or Adobe leftovers", () => {
    const html = renderSheet();
    for (const item of [...NAV, ...GC_NAV]) {
      expect(html).not.toContain(item.label);
      if (item.href !== "/") expect(html).not.toContain(`href="${item.href}"`);
    }
    for (const absent of ACCOUNT_SHEET_ABSENT) {
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

  it("does not restyle Ask Globee landing or merge account into the hamburger sheet", () => {
    expect(headerSrc).toContain("531:542");
    expect(headerSrc).not.toContain("544:561");
    expect(headerSrc).not.toContain("account-sheet");
    expect(landingSrc).not.toContain("account-sheet");
    expect(landingSrc).not.toContain("AccountSheet");
    expect(landingSrc).not.toContain("544:561");
    expect(navSrc).toContain("data-mobile-nav-sheet");
    expect(navSrc).toContain("AppSheetSurface");
    expect(navSrc).toContain("Close44");
    expect(navSrc).not.toContain("ACCOUNT");
    expect(navSrc).not.toContain("Manage account");
    expect(navSrc).not.toContain("User Profile");
    expect(navSrc).not.toContain("Company Profile");
    expect(menuSrc).toContain("MobileAccountMenu");
    expect(menuSrc).toContain("hidden md:block");
    expect(src).not.toContain("531:542");
    expect(src).not.toContain("462:502");
  });
});
