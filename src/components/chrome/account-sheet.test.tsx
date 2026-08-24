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
import {
  ACCOUNT_SHEET,
  ACCOUNT_SHEET_ABSENT,
  ACCOUNT_SHEET_HEAD_CLASS,
  ACCOUNT_SHEET_ITEMS,
  ACCOUNT_SHEET_LOGOUT_CLASS,
  ACCOUNT_SHEET_SURFACE_CLASS,
} from "@/lib/account-sheet";
import {
  APP_SHEET_RISE_CLASS,
  APP_SHEET_SCRIM_CLASS,
  APP_SHEET_SCRIM_FADE_CLASS,
  CLOSE_44_CLASS,
  SHEET_GROUP_CHEVRON_CLASS,
  SHEET_GROUP_ITEM_CLASS,
  TEXT_ACTION_CLASS,
} from "@/lib/house-sheet";
import { APPEARANCE } from "@/lib/appearance";
import { USER_MENU, userMenuVersion } from "@/lib/user-menu";
import { AccountSheet, AccountSheetAppearance, MobileAccountMenu } from "./account-sheet";

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

function tagWith(html: string, attr: string): string {
  const idx = html.indexOf(attr);
  if (idx < 0) return "";
  return html.slice(html.lastIndexOf("<", idx), html.indexOf(">", idx) + 1);
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
    expect(src).toContain("createPortal");
    expect(src).toContain("document.body");
    expect(src).not.toContain("data-mobile-nav");
  });
});

describe("AccountSheet 544:561 / 569:639", () => {
  it("rises from the bottom over a quiet scrim so the page stays under", () => {
    const html = renderSheet();
    const closeClass = buttonClass(html, "data-account-sheet-close");
    const headClass = attrClass(html, "data-account-sheet-head");
    const surfaceClass = attrClass(html, "data-account-sheet-surface");
    const scrimClass = attrClass(html, "data-account-sheet-scrim");
    const hostClass = attrClass(html, "data-account-sheet=\"\"");

    expect(html).toContain("data-account-sheet=\"\"");
    expect(html).toContain("data-account-sheet-scrim");
    expect(html).not.toContain("md:hidden");
    expect(html).toContain('aria-label="Account"');
    expect(hostClass).toContain("justify-end");
    expect(hostClass).not.toContain("bg-canvas");
    expect(scrimClass).toBe(APP_SHEET_SCRIM_CLASS);
    expect(scrimClass).toContain(APP_SHEET_SCRIM_FADE_CLASS);
    expect(surfaceClass).toBe(ACCOUNT_SHEET_SURFACE_CLASS);
    expect(surfaceClass).toContain(APP_SHEET_RISE_CLASS);
    expect(surfaceClass).toContain("h-[90dvh]");
    expect(surfaceClass).toContain("rounded-t-[16px]");
    expect(surfaceClass).toContain("bg-surface");
    expect(surfaceClass).toContain("p-[var(--space-6)]");
    expect(surfaceClass).toContain("md:w-[390px]");
    expect(surfaceClass).not.toContain("top-[var(--header-height)]");
    expect(surfaceClass).not.toContain("rounded-t-[24px]");
    expect(headClass).toBe(ACCOUNT_SHEET_HEAD_CLASS);
    expect(headClass).toContain("min-h-12");
    expect(headClass).toContain("justify-between");
    expect(headClass).toContain("items-center");
    expect(closeClass).toContain("rounded-full");
    expect(closeClass).toContain("bg-surface-muted");
    expect(closeClass).toContain("text-ink-3");
    expect(closeClass).toContain("size-[44px]");
    expect(CLOSE_44_CLASS.split(" ").every((token) => closeClass.includes(token))).toBe(true);
    expect(minBoxPx(closeClass, "min-h")).toBeGreaterThanOrEqual(44);
    expect(minBoxPx(closeClass, "min-w")).toBeGreaterThanOrEqual(44);
    expect(src).toContain("<Close44");
    expect(src).not.toMatch(/duration-\d|ease-out|ease-in|@keyframes|bounce/i);
    expect(houseSrc).toContain('<X className="size-4" strokeWidth={1.33} />');
    expect(src).toContain("event.key === \"Escape\"");
    expect(tokens).toMatch(/--space-6:\s*1\.5rem/);
    expect(tokens).toContain("--accent: #1769ff;");
  });

  it("puts Identity and Close/44 on one top row, centers aligned", () => {
    const html = renderSheet("ada@example.com", "Ada Lovelace");
    const head = html.slice(
      html.indexOf("data-account-sheet-head"),
      html.indexOf("data-account-sheet-rule"),
    );
    expect(head).toContain("data-identity-block");
    expect(head).toContain("data-account-sheet-close");
    expect(head.indexOf("data-identity-block")).toBeLessThan(head.indexOf("data-account-sheet-close"));
    expect(head).toContain("Ada Lovelace");
    expect(head).toContain("ada@example.com");
    expect(attrClass(html, "data-account-sheet-head")).toContain("min-h-12");
    expect(attrClass(html, "data-account-sheet-head")).toContain("items-center");
    expect(attrClass(html, "data-account-sheet-head")).toContain("justify-between");
  });

  it("puts the Identity half-bar flush on the main face and off Appearance", () => {
    const main = renderSheet();
    const appearance = renderToStaticMarkup(
      <AccountSheet
        email="ada@example.com"
        pathname="/"
        onClose={() => undefined}
        face="appearance"
      />,
    );
    const accent = attrClass(main, "data-menu-surface-accent");

    expect(main).toContain("data-menu-surface-accent");
    expect(accent).toContain("h-[4px]");
    expect(accent).toContain("w-1/2");
    expect(accent).toContain("left-0");
    expect(accent).toContain("top-0");
    expect(accent).toContain("bg-accent");
    expect(accent).not.toContain("w-full");
    expect(accent).not.toContain("bg-hairline");
    expect(appearance).not.toContain("data-menu-surface-accent");
    expect(src).toContain("<MenuSurfaceAccent");
    expect(src).toContain('{face === "main" ? <MenuSurfaceAccent /> : null}');
    expect(src).not.toContain("Adam Carpenter");
    expect(src).not.toContain("admin@ccbfg.com");
  });

  it("puts live Identity first: 48 circle, name 15 ink, email 13 tertiary, then hairline", () => {
    const html = renderSheet("ada@example.com");
    const identity = html.slice(
      html.indexOf("data-identity-block"),
      html.indexOf("data-account-sheet-rule"),
    );
    const profileClass = attrClass(html, 'data-sheet-group-item="profile"');
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
    expect(html).toContain(USER_MENU.profile);
    expect(html).toContain(`href="${USER_MENU.profileHref}"`);
    expect(profileClass).toBe(SHEET_GROUP_ITEM_CLASS);
    expect(src).toContain("<IdentityBlock");
    expect(html.indexOf("data-identity-block")).toBeLessThan(html.indexOf("data-account-sheet-rule"));
    expect(html.indexOf("data-account-sheet-rule")).toBeLessThan(html.indexOf('data-sheet-group-item="profile"'));
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

  it("lists Profile, Agreements, Appearance, Help, Refer a friend — then pinned Log out", () => {
    const html = renderSheet();
    const group = html.slice(html.indexOf("data-sheet-group"));
    const profileClass = attrClass(html, 'data-sheet-group-item="profile"');
    const agreementsClass = attrClass(html, 'data-sheet-group-item="agreements"');
    const appearanceClass = attrClass(html, 'data-sheet-group-item="appearance"');
    const helpClass = attrClass(html, 'data-sheet-group-item="help"');
    const referClass = attrClass(html, 'data-sheet-group-item="refer"');
    const logOutClass = attrClass(html, 'data-sheet-group-item="logOut"');

    expect(html).not.toContain("Manage account");
    expect(html).not.toContain("User Profile");
    expect(html).not.toContain("Company Profile");
    expect(html).not.toContain("Phone");
    expect(html).not.toContain("Job");
    expect(html).not.toContain("data-sheet-group-label");
    expect(html).not.toContain(">ACCOUNT<");
    expect(group.indexOf("Profile")).toBeLessThan(group.indexOf("Agreements"));
    expect(group.indexOf("Agreements")).toBeLessThan(group.indexOf("Appearance"));
    expect(group.indexOf("Appearance")).toBeLessThan(group.indexOf("Help"));
    expect(group.indexOf("Help")).toBeLessThan(group.indexOf("Refer a friend"));
    expect(html.indexOf("Refer a friend")).toBeLessThan(html.indexOf("Log out"));
    expect(html).toContain('data-sheet-group-item="profile"');
    expect(html).toContain('data-sheet-group-item="agreements"');
    expect(html).toContain('data-sheet-group-item="appearance"');
    expect(html).toContain('data-sheet-group-item="help"');
    expect(html).toContain('data-sheet-group-item="refer"');
    expect(html).toContain('data-sheet-group-item="logOut"');
    expect(html).toContain(`href="${USER_MENU.profileHref}"`);
    expect(html).toContain(`href="${USER_MENU.agreementsHref}"`);
    expect(html).toContain(`href="${USER_MENU.helpHref}"`);
    expect(html).toContain(`href="${USER_MENU.referHref}"`);
    expect(html).not.toContain("/account/appearance");
    expect(html).not.toContain("/account/company");
    expect(html).not.toContain('href="/account/profile"');
    expect(html).not.toContain("/settings");
    expect(ACCOUNT_SHEET_ITEMS).toBeDefined();
    expect(src).toContain('from "@/app/actions"');
    expect(src).toContain("void signOut()");
    expect(src).toContain("<SheetGroupItem");
    expect(src).toContain("<TextAction");
    expect(profileClass).toBe(agreementsClass);
    expect(profileClass).toBe(appearanceClass);
    expect(profileClass).toBe(helpClass);
    expect(profileClass).toBe(referClass);
    expect(profileClass).toBe(SHEET_GROUP_ITEM_CLASS);
    expect(profileClass).toContain("text-[length:var(--text-base)]");
    expect(profileClass).toContain("font-normal");
    expect(profileClass).toContain("text-ink");
    expect(profileClass).not.toContain("t-body-sm");
    expect(profileClass).not.toContain("text-accent");
    expect(logOutClass).toBe(ACCOUNT_SHEET_LOGOUT_CLASS);
    expect(logOutClass).toContain("text-accent");
    expect(logOutClass).not.toContain("text-ink ");
    expect(html).toContain(SHEET_GROUP_CHEVRON_CLASS);
    expect(html).toContain("stroke-width=\"1.33\"");
    expect(html).not.toContain("ThemeGlyph");
    expect(html).not.toContain("Light");
    expect(html).not.toContain("Dark");
    expect(html).not.toContain("Auto");
  });

  it("pins Log out, then hairline, then version + Legal — not in the scroll", () => {
    const html = renderSheet();
    const scrollEnd = html.indexOf("data-account-sheet-scroll");
    const logoutRule = html.indexOf("data-account-sheet-logout-rule");
    const logout = html.indexOf('data-sheet-group-item="logOut"');
    const footerRule = html.indexOf("data-account-sheet-footer-rule");
    const footer = html.indexOf('data-account-sheet-footer=""');
    const version = html.indexOf("data-account-sheet-version");
    const legal = html.indexOf("data-account-sheet-legal");

    expect(logoutRule).toBeGreaterThan(scrollEnd);
    expect(logout).toBeGreaterThan(logoutRule);
    expect(footerRule).toBeGreaterThan(logout);
    expect(footer).toBeGreaterThan(footerRule);
    expect(version).toBeGreaterThan(footer);
    expect(legal).toBeGreaterThan(version);
    expect(html).toContain(userMenuVersion());
    expect(html).toContain(">v0.1.0<");
    expect(html).toContain(USER_MENU.legal);
    expect(html).toContain(`href="${USER_MENU.legalHref}"`);
    const legalTag = tagWith(html, "data-account-sheet-legal");
    expect(legalTag).toContain(`href="${USER_MENU.legalHref}"`);
    expect(legalTag).toContain('target="_blank"');
    expect(legalTag).toContain('rel="noopener"');
    expect(tagWith(html, `href="${USER_MENU.profileHref}"`)).not.toContain('target="_blank"');
    expect(tagWith(html, `href="${USER_MENU.helpHref}"`)).not.toContain('target="_blank"');
    expect(src.match(/target="_blank"/g)?.length).toBe(1);
    expect(src).toContain("<TextAction href={USER_MENU.legalHref}");
    expect(src).toContain('rel="noopener"');
    expect(attrClass(html, "data-account-sheet-legal")).toContain(TEXT_ACTION_CLASS);
    expect(html.slice(html.indexOf("data-account-sheet-scroll"), html.indexOf("data-account-sheet-logout-rule"))).not.toContain("v0.1.0");
    expect(html.slice(html.indexOf("data-account-sheet-scroll"), html.indexOf("data-account-sheet-logout-rule"))).not.toContain("Log out");
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
    expect(src).not.toContain("/account/appearance");
    expect(src).not.toContain("type=\"radio\"");
  });

  it("opens Appearance as a second face with Back to main menu and quiet checks", () => {
    const html = renderToStaticMarkup(<AccountSheetAppearance onBack={() => undefined} />);
    const backClass = attrClass(html, 'data-sheet-group-item="back"');
    const lightClass = attrClass(html, 'data-sheet-group-item="light"');
    const darkClass = attrClass(html, 'data-sheet-group-item="dark"');
    const autoClass = attrClass(html, 'data-sheet-group-item="auto"');

    expect(html).toContain(APPEARANCE.back);
    expect(html).toContain(APPEARANCE.light);
    expect(html).toContain(APPEARANCE.dark);
    expect(html).toContain(APPEARANCE.auto);
    expect(html).toContain("data-appearance-check");
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("role=\"radiogroup\"");
    expect(html).not.toContain("/account/appearance");
    expect(html).not.toContain("User Profile");
    expect(html).not.toContain("ThemeGlyph");
    expect(backClass).toBe(SHEET_GROUP_ITEM_CLASS);
    expect(lightClass).toBe(darkClass);
    expect(lightClass).toBe(autoClass);
    expect(src).toContain("AccountSheetAppearance");
    expect(src).toContain('setFace("appearance")');
    expect(src).toContain("applyDocumentThemePreference");
    expect(src).toContain("AppearanceCheck");
    expect(src).toContain("APPEARANCE.back");
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
    expect(menuSrc).toContain("DesktopAccountMenu");
    expect(src).not.toContain("531:542");
    expect(src).not.toContain("462:502");
  });
});
