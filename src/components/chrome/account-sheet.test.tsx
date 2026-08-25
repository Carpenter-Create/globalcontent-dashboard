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
  ACCOUNT_MENU_APPEARANCE_CHEVRON_CLASS,
  ACCOUNT_MENU_APPEARANCE_FLYOUT_CLASS,
  ACCOUNT_MENU_APPEARANCE_ROW_CLASS,
  ACCOUNT_MENU_DROPDOWN_DISMISS_CLASS,
  ACCOUNT_MENU_DROPDOWN_HOST_CLASS,
  ACCOUNT_MENU_DROPDOWN_PIN_CLASS,
  ACCOUNT_MENU_DROPDOWN_SCROLL_CLASS,
  ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS,
  ACCOUNT_SHEET_APPEARANCE_COPY_CLASS,
  ACCOUNT_SHEET,
  ACCOUNT_SHEET_ABSENT,
  ACCOUNT_SHEET_HEAD_CLASS,
  ACCOUNT_SHEET_HOST_CLASS,
  ACCOUNT_SHEET_ITEMS,
  ACCOUNT_SHEET_LEGAL_CLASS,
  ACCOUNT_SHEET_LOGOUT_CLASS,
  ACCOUNT_SHEET_PIN_CLASS,
  ACCOUNT_SHEET_SURFACE_CLASS,
  ACCOUNT_SHEET_VERSION_CLASS,
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
import {
  AccountMenuDropdown,
  AccountSheet,
  AccountSheetAppearance,
  DesktopAccountMenu,
  MobileAccountMenu,
} from "./account-sheet";

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

function renderDropdown(email = "ada@example.com", name?: string | null): string {
  return renderToStaticMarkup(
    <AccountMenuDropdown email={email} name={name} pathname="/" onClose={() => undefined} />,
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

describe("AccountSheet 544:561 / 537:557", () => {
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
    expect(hostClass).toBe(ACCOUNT_SHEET_HOST_CLASS);
    expect(hostClass).toContain("justify-end");
    expect(hostClass).not.toContain("md:flex-row");
    expect(hostClass).not.toContain("md:items-end");
    expect(hostClass).not.toContain("bg-canvas");
    expect(scrimClass).toBe(APP_SHEET_SCRIM_CLASS);
    expect(scrimClass).toContain(APP_SHEET_SCRIM_FADE_CLASS);
    expect(surfaceClass).toBe(ACCOUNT_SHEET_SURFACE_CLASS);
    expect(surfaceClass).toContain(APP_SHEET_RISE_CLASS);
    expect(surfaceClass).toContain("h-[90dvh]");
    expect(surfaceClass).not.toContain("h-auto");
    expect(surfaceClass).not.toContain("max-h-[90dvh]");
    expect(surfaceClass).toContain("rounded-t-[16px]");
    expect(surfaceClass).toContain("bg-surface");
    expect(surfaceClass).toContain("px-[var(--space-6)]");
    expect(surfaceClass).toContain("pb-[var(--space-8)]");
    expect(surfaceClass).not.toContain("pb-[var(--space-12)]");
    expect(surfaceClass).toContain("pt-[calc(4px+var(--space-8))]");
    expect(surfaceClass.split(" ")).not.toContain("p-[var(--space-6)]");
    expect(surfaceClass).not.toContain("md:w-[390px]");
    expect(surfaceClass).not.toContain("w-[264px]");
    expect(surfaceClass).not.toContain("w-[277px]");
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
    expect(tokens).toMatch(/--space-8:\s*2rem/);
    expect(tokens).toContain("--accent: #1769ff;");
  });

  it("gives 32 clear under the half-bar and 32 bottom pad — sides stay 24", () => {
    const html = renderSheet();
    const surfaceClass = attrClass(html, "data-account-sheet-surface");
    const accent = attrClass(html, "data-menu-surface-accent");
    const dropdownSurface = ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS;

    expect(surfaceClass).toBe(ACCOUNT_SHEET_SURFACE_CLASS);
    expect(surfaceClass).toContain("px-[var(--space-6)]");
    expect(surfaceClass).toContain("pb-[var(--space-8)]");
    expect(surfaceClass).not.toContain("pb-[var(--space-12)]");
    expect(surfaceClass).toContain("pt-[calc(4px+var(--space-8))]");
    expect(surfaceClass.split(" ")).not.toContain("p-[var(--space-6)]");
    expect(accent).toContain("top-0");
    expect(accent).toContain("h-[4px]");
    expect(accent).toContain("w-1/2");
    expect(accent).toContain("left-0");
    expect(accent).toContain("bg-accent");
    expect(accent).not.toContain("#1769");
    expect(dropdownSurface).toContain("px-[var(--space-6)]");
    expect(dropdownSurface).toContain("pb-[var(--space-6)]");
    expect(dropdownSurface).toContain("h-auto");
    expect(dropdownSurface).not.toMatch(/h-\[\d+px\]/);
    expect(dropdownSurface).not.toContain("min-h");
    expect(dropdownSurface).not.toContain("h-[522px]");
    expect(dropdownSurface).not.toContain("h-[570px]");
    expect(dropdownSurface).not.toContain("h-[672px]");
    expect(dropdownSurface).toContain("pt-[calc(4px+var(--space-6))]");
    expect(dropdownSurface).not.toContain("min-h-[426px]");
    expect(dropdownSurface).not.toContain("px-[var(--space-4)]");
    expect(dropdownSurface).not.toContain("pb-[var(--space-4)]");
    expect(dropdownSurface).not.toContain("gap-[var(--space-4)]");
    expect(dropdownSurface).not.toContain("pt-[calc(4px+var(--space-8))]");
    expect(dropdownSurface).not.toContain("pb-[var(--space-8)]");
    expect(dropdownSurface).not.toContain("pb-[var(--space-12)]");
    expect(dropdownSurface).not.toContain("min-h-[384px]");
    expect(dropdownSurface.split(" ")).not.toContain("p-[var(--space-6)]");
    expect(tokens).toMatch(/--space-8:\s*2rem/);
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

  it("keeps the Identity half-bar on the same 90% sheet while Appearance is open", () => {
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
    expect(appearance).toContain("data-menu-surface-accent");
    expect(appearance).toContain("data-identity-block");
    expect(appearance).toContain("data-account-sheet-close");
    expect(appearance).not.toContain("data-account-menu-appearance-flyout");
    expect(src).toContain("<MenuSurfaceAccent");
    expect(src).not.toContain('{face === "main" ? <MenuSurfaceAccent /> : null}');
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

  it("lists Profile, Agreements, Appearance, Help, Refer a friend — then Log out with the footer", () => {
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
    expect(html).toContain("/settings/profile");
    expect(html).toContain("/settings/agreements");
    expect(html).toContain("/settings/refer");
    expect(ACCOUNT_SHEET_ITEMS).toBeDefined();
    expect(src).toContain('from "@/app/actions"');
    expect(src).toContain("void signOut()");
    expect(src).toContain("<SheetGroupItem");
    expect(src).toContain("<TextAction");
    expect(profileClass).toBe(agreementsClass);
    expect(profileClass).toBe(helpClass);
    expect(profileClass).toBe(referClass);
    expect(profileClass).toBe(SHEET_GROUP_ITEM_CLASS);
    expect(appearanceClass).toBe(ACCOUNT_MENU_APPEARANCE_ROW_CLASS);
    expect(appearanceClass).toContain("py-[var(--space-4)]");
    expect(appearanceClass).not.toContain("rounded");
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
    expect(html).toContain("data-account-menu-appearance-mode");
    expect(html).toContain("Light");
    expect(html).not.toContain("data-account-menu-appearance-flyout");
    expect(html).not.toContain("data-account-sheet-appearance-stack");
    expect(html).not.toContain("data-account-sheet-appearance-flyout-host");
    expect(html).not.toContain("System default");
    expect(html).not.toContain("Dark");
    expect(html).not.toContain("Auto");
  });

  it("keeps Log out with the footer — leftover is the 90% grow, hairline only under Log out", () => {
    const html = renderSheet();
    const scrollEnd = html.indexOf("data-account-sheet-scroll");
    const logout = html.indexOf('data-sheet-group-item="logOut"');
    const footerRule = html.indexOf("data-account-sheet-footer-rule");
    const footer = html.indexOf('data-account-sheet-footer=""');
    const version = html.indexOf("data-account-sheet-version");
    const legal = html.indexOf("data-account-sheet-legal");
    const pinClass = attrClass(html, "data-account-sheet-pin");
    const scrollClass = attrClass(html, "data-account-sheet-scroll");
    const groupEnd = html.indexOf("</div>", html.indexOf('data-sheet-group-item="refer"'));

    expect(html).not.toContain("data-account-sheet-logout-rule");
    expect(logout).toBeGreaterThan(scrollEnd);
    expect(footerRule).toBeGreaterThan(logout);
    expect(footer).toBeGreaterThan(footerRule);
    expect(version).toBeGreaterThan(footer);
    expect(legal).toBeGreaterThan(version);
    expect(groupEnd).toBeGreaterThan(-1);
    expect(groupEnd).toBeLessThan(logout);
    expect(html.slice(html.indexOf("data-account-sheet-scroll"), logout)).not.toContain("Log out");
    expect(html.slice(html.indexOf("data-account-sheet-scroll"), logout)).not.toContain("v0.1.0");
    expect(scrollClass).toContain("flex-1");
    expect(scrollClass).toContain("min-h-0");
    expect(scrollClass).not.toContain("min-h-[var(--space-12)]");
    expect(scrollClass).not.toContain("overflow-y-auto");
    expect(attrClass(html, "data-account-sheet-surface")).toContain("overflow-y-auto");
    expect(attrClass(html, "data-account-sheet-surface")).toContain("h-[90dvh]");
    expect(attrClass(html, "data-account-sheet-surface")).not.toContain("h-auto");
    expect(attrClass(html, "data-account-sheet-surface")).not.toContain("max-h-[90dvh]");
    expect(attrClass(html, "data-account-sheet-surface")).toContain("gap-[var(--space-6)]");
    expect(pinClass).toBe(ACCOUNT_SHEET_PIN_CLASS);
    expect(pinClass).toContain("gap-[var(--space-6)]");
    expect(pinClass).not.toContain("gap-[var(--space-12)]");
    expect(attrClass(html, "data-account-sheet-surface")).toContain("pb-[var(--space-8)]");
    expect(attrClass(html, "data-account-sheet-surface")).not.toContain("pb-[var(--space-12)]");
    const refer = html.indexOf('data-sheet-group-item="refer"');
    const betweenReferAndLogout = html.slice(refer, logout);
    expect(betweenReferAndLogout).not.toContain("data-account-sheet-footer-rule");
    expect(betweenReferAndLogout).not.toContain("bg-hairline");
    expect(html.slice(logout, footer)).toContain("data-account-sheet-footer-rule");
    const logoutStack = html.slice(
      html.indexOf("data-account-sheet-logout-stack"),
      html.indexOf("</div>", html.indexOf("data-account-sheet-logout-stack")),
    );
    expect(logoutStack).toContain("logOut");
    expect(logoutStack).not.toContain("data-account-sheet-footer-rule");
    expect(logoutStack).not.toContain("bg-hairline");
    expect(src).toContain("ACCOUNT_SHEET_PIN_CLASS");
    expect(src).toContain('data-account-sheet-pin=""');
    expect(src).toContain("<AccountMenuPin");
    expect(src.slice(
      src.indexOf("function AccountMenuLogOut"),
      src.indexOf("function AccountMenuPin"),
    )).not.toContain("AppSheetHairline");
    expect(src.slice(
      src.indexOf("function AccountMenuPin"),
      src.indexOf("function AccountAppearanceRow"),
    )).toContain("AppSheetHairline");
    expect(src).not.toContain("data-account-sheet-logout-rule");
    expect(src).toContain("data-account-sheet-footer-rule");
    expect(src).toContain("571:911 stays off");
    expect(src).toContain("618:785 overlay");
    expect(src).toContain("is void");
    expect(src).toContain("Log out → hairline 24");
    expect(src).toContain("Hairline → footer 24");
    expect(src).toContain("Footer → bottom 32");
    expect(src).not.toContain("Log out → hairline 48");
    expect(src).not.toContain("Footer → bottom 48");
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
    expect(src).toContain('className="leading-4"');
    expect(attrClass(html, "data-account-sheet-legal")).toContain(TEXT_ACTION_CLASS);
    expect(attrClass(html, "data-account-sheet-legal")).toBe(ACCOUNT_SHEET_LEGAL_CLASS);
    expect(attrClass(html, "data-account-sheet-legal")).toContain("leading-4");
    expect(attrClass(html, "data-account-sheet-version")).toBe(ACCOUNT_SHEET_VERSION_CLASS);
    expect(attrClass(html, "data-account-sheet-version")).toContain("leading-4");
    expect(attrClass(html, "data-account-sheet-version")).toContain("text-ink-3");
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

  it("opens Appearance as a same-sheet drill-in — Back 16 tertiary, System default + helper / Dark / Light, check 16", () => {
    const html = renderToStaticMarkup(<AccountSheetAppearance onBack={() => undefined} />);
    const sheet = renderToStaticMarkup(
      <AccountSheet
        email="ada@example.com"
        pathname="/"
        onClose={() => undefined}
        face="appearance"
      />,
    );
    const backClass = attrClass(html, 'data-sheet-group-item="back"');
    const lightClass = attrClass(html, 'data-sheet-group-item="light"');
    const darkClass = attrClass(html, 'data-sheet-group-item="dark"');
    const autoClass = attrClass(html, 'data-sheet-group-item="auto"');
    const backTag = tagWith(html, 'data-sheet-group-item="back"');

    expect(html).not.toContain("Back to main menu");
    expect(backTag).toContain(`aria-label="${APPEARANCE.back}"`);
    expect(html).toContain("lucide-chevron-left");
    expect(html).toContain(SHEET_GROUP_CHEVRON_CLASS);
    expect(html).toContain("stroke-width=\"1.33\"");
    expect(html).toContain("text-ink-3");
    expect(backTag).not.toContain("Back to main menu");
    expect(html).toContain(APPEARANCE.systemDefault);
    expect(html.replaceAll("&#x27;", "'")).toContain(APPEARANCE.systemDefaultHelper);
    expect(html).toContain(APPEARANCE.light);
    expect(html).toContain(APPEARANCE.dark);
    expect(html).not.toContain(">Auto<");
    expect(html).toContain("data-appearance-check");
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("role=\"radiogroup\"");
    expect(html).not.toContain("/account/appearance");
    expect(html).not.toContain("User Profile");
    expect(html).not.toContain("ThemeGlyph");
    expect(html).not.toContain("purple");
    expect(html).not.toContain("violet");
    expect(backClass).toBe(SHEET_GROUP_ITEM_CLASS);
    expect(lightClass).toBe(darkClass);
    expect(lightClass).toBe(autoClass);
    expect(lightClass).toBe(SHEET_GROUP_ITEM_CLASS);
    expect(html).toContain(ACCOUNT_SHEET_APPEARANCE_COPY_CLASS);
    expect(sheet).toContain("data-identity-block");
    expect(sheet).toContain("data-account-sheet-close");
    expect(sheet).toContain('data-sheet-group-item="back"');
    expect(sheet).not.toContain('data-sheet-group-item="profile"');
    expect(sheet).not.toContain('data-sheet-group-item="appearance"');
    expect(sheet).not.toContain("data-account-menu-appearance-flyout");
    expect(sheet).not.toContain("data-account-sheet-pin");
    expect(sheet).not.toContain("data-account-sheet-appearance-stack");
    expect(sheet).not.toContain("data-account-sheet-appearance-flyout-host");
    expect(sheet).not.toContain("w-[342px]");
    expect(attrClass(sheet, "data-appearance-check")).toContain("text-ink-3");
    expect(attrClass(sheet, "data-appearance-check")).not.toContain("text-ink ");
    expect(sheet).not.toContain("data-account-menu-appearance-wash");
    expect(src).toContain("AccountBackChevron");
    expect(src).toContain("ChevronLeft");
    expect(src).toContain("APPEARANCE.back");
    expect(src).toContain("AccountAppearanceFlyout");
    expect(src).toContain("applyDocumentThemePreference");
    expect(src).toContain("AppearanceCheck");
    expect(src).toContain("ACCOUNT_SHEET_APPEARANCE_COPY_CLASS");
    expect(src).not.toContain("Back to main menu");
    expect(src).toContain("618:785 overlay is void");
    expect(src).not.toContain("w-[342px]");
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

describe("AccountMenuDropdown 629:795", () => {
  it("hugs the stack — leftover killed, not a 90% sheet and not a tall right takeover", () => {
    const html = renderDropdown("ada@example.com", "Ada Lovelace");
    const hostClass = attrClass(html, 'data-user-menu-desktop-panel=""');
    const surfaceClass = attrClass(html, "data-user-menu-desktop-surface");
    const dismissClass = attrClass(html, "data-user-menu-desktop-dismiss");
    const scrollClass = attrClass(html, "data-account-sheet-scroll");

    expect(html).toContain("data-user-menu-desktop-panel");
    expect(html).toContain("data-user-menu-desktop-surface");
    expect(html).not.toContain("data-account-sheet=\"\"");
    expect(html).not.toContain("data-account-sheet-scrim");
    expect(html).not.toContain("data-account-menu-leftover");
    expect(hostClass).toBe(ACCOUNT_MENU_DROPDOWN_HOST_CLASS);
    expect(hostClass).not.toContain("justify-end");
    expect(hostClass).not.toContain("h-dvh");
    expect(hostClass).not.toContain("md:flex-row");
    expect(hostClass).not.toContain("md:items-end");
    expect(dismissClass).toBe(ACCOUNT_MENU_DROPDOWN_DISMISS_CLASS);
    expect(dismissClass).not.toContain("bg-ink");
    expect(dismissClass).not.toContain(APP_SHEET_SCRIM_FADE_CLASS);
    expect(surfaceClass).toBe(ACCOUNT_MENU_DROPDOWN_SURFACE_CLASS);
    expect(surfaceClass).toContain("h-auto");
    expect(surfaceClass).toContain("w-[264px]");
    expect(surfaceClass).not.toMatch(/h-\[\d+px\]/);
    expect(surfaceClass).not.toContain("min-h");
    expect(surfaceClass).not.toContain("h-[522px]");
    expect(surfaceClass).not.toContain("h-[570px]");
    expect(surfaceClass).not.toContain("h-[672px]");
    expect(surfaceClass).not.toContain("min-h-[426px]");
    expect(surfaceClass).not.toContain("min-h-[384px]");
    expect(surfaceClass).not.toContain("h-[384px]");
    expect(surfaceClass).toContain("rounded-[12px]");
    expect(surfaceClass).toContain("px-[var(--space-6)]");
    expect(surfaceClass).toContain("pb-[var(--space-6)]");
    expect(surfaceClass).toContain("pt-[calc(4px+var(--space-6))]");
    expect(surfaceClass).not.toContain("gap-[var(--space-6)]");
    expect(surfaceClass).not.toContain("px-[var(--space-4)]");
    expect(surfaceClass).not.toContain("pb-[var(--space-4)]");
    expect(surfaceClass).not.toContain("gap-[var(--space-4)]");
    expect(surfaceClass).toContain("overflow-hidden");
    expect(surfaceClass).not.toContain("top-[calc(var(--header-height)+var(--space-2))]");
    expect(surfaceClass).not.toContain("right-[var(--content-inset)]");
    expect(surfaceClass).not.toContain("--header-height");
    expect(surfaceClass).not.toContain("--content-inset");
    expect(html).toContain('data-account-menu-align="end"');
    expect(src).toContain("accountMenuDropdownAlignEnd");
    expect(src).toContain("useDesktopAccountMenuAlignEnd");
    expect(src).toContain("alignEnd={alignEnd}");
    expect(src).toContain("triggerRef={triggerRef}");
    expect(tokens).toMatch(/--space-2:\s*0\.5rem/);
    expect(surfaceClass).not.toContain("w-[277px]");
    expect(surfaceClass).not.toContain("h-[90dvh]");
    expect(surfaceClass).not.toContain("md:w-[390px]");
    expect(surfaceClass).not.toContain(APP_SHEET_RISE_CLASS);
    expect(scrollClass).toBe(ACCOUNT_MENU_DROPDOWN_SCROLL_CLASS);
    expect(scrollClass).toContain("shrink-0");
    expect(scrollClass).not.toContain("flex-1");
    expect(src).not.toContain("ACCOUNT_MENU_DROPDOWN_LEFTOVER");
    expect(src).not.toContain("data-account-menu-leftover");
    expect(src).not.toContain("h-[522px]");
    expect(src).not.toContain("h-[570px]");
    expect(src).not.toContain("h-[672px]");
    expect(src).not.toContain("min-h-[672px]");
    expect(src).toContain("useAccountMenuDismiss(onClose, false)");
    expect(src).not.toContain("md:w-[390px]");
    expect(tokens).toMatch(/--space-4:\s*1rem/);
    expect(tokens).toMatch(/--space-6:\s*1\.5rem/);
    expect(tokens).toContain("--accent: #1769ff;");
  });

  it("kills Close, stacks live identity, and never ellipsizes name or email", () => {
    const html = renderDropdown("ada@example.com", "Ada Lovelace");
    const long = renderDropdown(
      "very.long.local-part@studio.example.com",
      "Ada King-Noel Lovelace Byron",
    );
    const head = html.slice(
      html.indexOf("data-account-sheet-head"),
      html.indexOf("data-account-sheet-rule"),
    );
    const identityClass = attrClass(html, "data-identity-block");
    const nameClass = attrClass(html, "data-identity-name");
    const emailClass = attrClass(html, "data-identity-email");
    const avatarClass = attrClass(html, "data-identity-avatar");

    expect(html).not.toContain("data-account-sheet-close");
    expect(head).not.toContain("Close account");
    expect(head).toContain("data-identity-block");
    expect(head).toContain("Ada Lovelace");
    expect(head).toContain("ada@example.com");
    expect(identityClass).toContain("flex-col");
    expect(identityClass).toContain("items-start");
    expect(identityClass).not.toContain("truncate");
    expect(nameClass).not.toContain("truncate");
    expect(nameClass).not.toContain("ellipsis");
    expect(emailClass).not.toContain("truncate");
    expect(emailClass).not.toContain("ellipsis");
    expect(avatarClass).toContain("size-12");
    expect(html).not.toContain("Adam Carpenter");
    expect(html).not.toContain("admin@ccbfg.com");
    expect(long).toContain("Ada King-Noel Lovelace Byron");
    expect(long).toContain("very.long.local-part@studio.example.com");
    expect(long).not.toContain("…");
    expect(long).not.toContain("&hellip;");
    expect(src).toContain("open ? closeMenu : openMenu");
    expect(src).toContain('variant="dropdown"');
    expect(src).toContain('variant="sheet"');
  });

  it("keeps 24 between items — leftover last-item → Log out is 0, hairline only under Log out", () => {
    const html = renderDropdown();
    const surfaceClass = attrClass(html, "data-user-menu-desktop-surface");
    const scrollClass = attrClass(html, "data-account-sheet-scroll");
    const groupClass = attrClass(html, "data-sheet-group");
    const pinClass = attrClass(html, "data-account-sheet-pin");
    const refer = html.indexOf('data-sheet-group-item="refer"');
    const logout = html.indexOf('data-sheet-group-item="logOut"');
    const footerRule = html.indexOf("data-account-sheet-footer-rule");
    const footer = html.indexOf('data-account-sheet-footer=""');
    const betweenReferAndLogout = html.slice(refer, logout);

    expect(html).toContain("data-account-sheet-pin");
    expect(html).not.toContain("data-account-sheet-logout-rule");
    expect(html).not.toContain("data-account-menu-leftover");
    expect(surfaceClass).toContain("h-auto");
    expect(surfaceClass).not.toMatch(/h-\[\d+px\]/);
    expect(surfaceClass).not.toContain("min-h");
    expect(surfaceClass).not.toContain("h-[522px]");
    expect(surfaceClass).not.toContain("h-[570px]");
    expect(surfaceClass).not.toContain("h-[672px]");
    expect(surfaceClass).not.toContain("min-h-[426px]");
    expect(surfaceClass).not.toContain("min-h-[384px]");
    expect(surfaceClass).toContain("w-[264px]");
    expect(surfaceClass).not.toContain("gap-[var(--space-6)]");
    expect(surfaceClass).toContain("px-[var(--space-6)]");
    expect(surfaceClass).toContain("pb-[var(--space-6)]");
    expect(surfaceClass).toContain("pt-[calc(4px+var(--space-6))]");
    expect(surfaceClass).not.toContain("gap-[var(--space-4)]");
    expect(surfaceClass).not.toContain("px-[var(--space-4)]");
    expect(surfaceClass).not.toContain("pb-[var(--space-4)]");
    expect(surfaceClass).not.toContain("h-[90dvh]");
    expect(surfaceClass).not.toContain("pb-[var(--space-12)]");
    expect(scrollClass).toBe(ACCOUNT_MENU_DROPDOWN_SCROLL_CLASS);
    expect(scrollClass).toContain("shrink-0");
    expect(scrollClass).not.toContain("flex-1");
    expect(scrollClass).not.toContain("overflow-y-auto");
    expect(groupClass).toContain("gap-[var(--space-6)]");
    expect(groupClass).not.toContain("gap-[var(--space-4)]");
    expect(pinClass).toBe(ACCOUNT_MENU_DROPDOWN_PIN_CLASS);
    expect(pinClass).not.toContain("mt-");
    expect(pinClass).toContain("gap-[var(--space-6)]");
    expect(pinClass).not.toContain("gap-[var(--space-12)]");
    expect(refer).toBeGreaterThan(-1);
    expect(logout).toBeGreaterThan(refer);
    expect(betweenReferAndLogout).not.toContain("data-account-menu-leftover");
    expect(footerRule).toBeGreaterThan(logout);
    expect(footer).toBeGreaterThan(footerRule);
    expect(betweenReferAndLogout).not.toContain("data-account-sheet-footer-rule");
    expect(betweenReferAndLogout).not.toContain("bg-hairline");
    expect(html.slice(logout, footer)).toContain("data-account-sheet-footer-rule");
    const logoutStack = html.slice(
      html.indexOf("data-account-sheet-logout-stack"),
      html.indexOf("</div>", html.indexOf("data-account-sheet-logout-stack")),
    );
    expect(logoutStack).toContain("logOut");
    expect(logoutStack).not.toContain("data-account-sheet-footer-rule");
    expect(logoutStack).not.toContain("bg-hairline");
    expect(src).toContain("ACCOUNT_MENU_DROPDOWN_PIN_CLASS");
    expect(src).toContain("ACCOUNT_SHEET_PIN_CLASS");
    expect(src).toContain("<AccountMenuPin");
  });

  it("keeps the same SSOT items, Sporty Blue Log out, and pinned 13/16 footer", () => {
    const html = renderDropdown();
    const legalTag = tagWith(html, "data-account-sheet-legal");

    expect(html).toContain("Profile");
    expect(html).toContain("Agreements");
    expect(html).toContain("Appearance");
    expect(html).toContain("Help");
    expect(html).toContain("Refer a friend");
    expect(html).toContain("Log out");
    expect(html).toContain(">v0.1.0<");
    expect(html).toContain(USER_MENU.legal);
    expect(html).toContain('data-user-menu-item="logOut"');
    expect(attrClass(html, 'data-sheet-group-item="logOut"')).toContain("text-accent");
    expect(attrClass(html, "data-account-sheet-version")).toBe(ACCOUNT_SHEET_VERSION_CLASS);
    expect(attrClass(html, "data-account-sheet-version")).toContain("leading-4");
    expect(attrClass(html, "data-account-sheet-legal")).toBe(ACCOUNT_SHEET_LEGAL_CLASS);
    expect(attrClass(html, "data-account-sheet-legal")).toContain("leading-4");
    expect(legalTag).toContain(`href="${USER_MENU.legalHref}"`);
    expect(legalTag).toContain('target="_blank"');
    expect(legalTag).toContain('rel="noopener"');
    expect(html).toContain("data-account-menu-appearance-mode");
    expect(html).toContain("Light");
    expect(html).not.toContain("data-account-menu-appearance-flyout");
    expect(html).not.toContain("data-account-sheet-appearance-stack");
    expect(html).not.toContain("data-account-sheet-appearance-flyout-host");
    expect(html).not.toContain("System default");
    expect(html).not.toContain("Dark");
    expect(html).not.toContain("Auto");
    expect(html).not.toContain("/account/appearance");
  });

  it("keeps the Identity half-bar and opens 613:888 as a second 264 surface to the left", () => {
    const main = renderDropdown();
    const appearance = renderToStaticMarkup(
      <AccountMenuDropdown
        email="ada@example.com"
        pathname="/"
        onClose={() => undefined}
        face="appearance"
        alignEnd={{ top: "calc(44px + var(--space-2))", right: "16px" }}
      />,
    );
    const accent = attrClass(main, "data-menu-surface-accent");
    const flyoutHost = tagWith(appearance, "data-user-menu-appearance-flyout-host");
    const flyoutClass = attrClass(appearance, "data-account-menu-appearance-flyout");
    const washClass = attrClass(appearance, "data-account-menu-appearance-wash");

    expect(main).toContain("data-menu-surface-accent");
    expect(accent).toContain("h-[4px]");
    expect(accent).toContain("w-1/2");
    expect(accent).toContain("left-0");
    expect(accent).toContain("bg-accent");
    expect(accent).not.toContain("#1769");
    expect(appearance).toContain("data-menu-surface-accent");
    expect(appearance).toContain("data-identity-block");
    expect(appearance).toContain('data-sheet-group-item="profile"');
    expect(appearance).not.toContain("data-account-sheet-close");
    expect(appearance).toContain("data-account-menu-appearance-flyout");
    expect(appearance).toContain("System default");
    expect(appearance.replaceAll("&#x27;", "'")).toContain(APPEARANCE.systemDefaultHelper);
    expect(appearance).toContain("Dark");
    expect(appearance).not.toContain(">Auto<");
    expect(appearance).not.toContain("purple");
    expect(appearance).not.toContain("violet");
    expect(flyoutClass).toBe(ACCOUNT_MENU_APPEARANCE_FLYOUT_CLASS);
    expect(flyoutClass).toContain("w-[264px]");
    expect(flyoutClass).not.toContain("w-[342px]");
    expect(flyoutClass).toContain("rounded-[12px]");
    expect(appearance).not.toContain("data-account-sheet-appearance-stack");
    expect(appearance).not.toContain("data-account-sheet-appearance-flyout-host");
    expect(flyoutHost).toContain("calc(16px + 264px + var(--space-2))");
    expect(flyoutHost).not.toContain("calc(44px + var(--space-2))");
    expect(src).toContain("accountMenuAppearanceFlyoutAlign(alignEnd, row.getBoundingClientRect())");
    expect(src).toContain("appearanceRowRef");
    expect(src).toContain("host.style.top = align.top");
    expect(src).not.toContain("top: parent.top");
    expect(src).not.toContain("top: alignEnd.top");
    expect(washClass).toContain("-left-[var(--space-6)]");
    expect(washClass).toContain("z-0");
    expect(washClass).not.toContain("rounded");
    expect(attrClass(appearance, "data-account-menu-appearance-chevron")).toBe(
      ACCOUNT_MENU_APPEARANCE_CHEVRON_CLASS,
    );
    expect(attrClass(appearance, "data-account-menu-appearance-chevron")).toContain("z-10");
  });

  it("opens from the desktop avatar and does not reuse the 90% sheet", () => {
    const html = renderToStaticMarkup(<DesktopAccountMenu email="nina@studio.com" />);
    expect(html).toContain("data-user-menu-desktop");
    expect(html).toContain("data-user-menu-trigger");
    expect(html).toContain("hidden md:block");
    expect(html).toContain(">N<");
    expect(html).not.toContain("data-user-menu-desktop-panel");
    expect(html).not.toContain("data-account-sheet=\"\"");
    expect(src).toContain("<AccountMenuDropdown");
    expect(src).toContain("DesktopAccountMenu");
    const desktop = src.slice(src.indexOf("export function DesktopAccountMenu"));
    expect(desktop).toContain("<AccountMenuDropdown");
    expect(desktop.slice(0, desktop.indexOf("export function AccountSheet"))).not.toContain(
      "<AccountSheet",
    );
  });

  it("applies align-end so the 264 right edge is flush to the avatar", () => {
    const html = renderToStaticMarkup(
      <AccountMenuDropdown
        email="ada@example.com"
        pathname="/"
        onClose={() => undefined}
        alignEnd={{ top: "calc(44px + var(--space-2))", right: "16px" }}
      />,
    );
    const surface = tagWith(html, "data-user-menu-desktop-surface");

    expect(html).toContain('data-account-menu-align="end"');
    expect(surface).toContain("calc(44px + var(--space-2))");
    expect(surface).toContain("16px");
    expect(surface).not.toContain("--header-height");
    expect(surface).not.toContain("--content-inset");
  });
});
