import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { USER_MENU } from "@/lib/user-menu";
import { ASK_GLOBEE } from "@/lib/ask-globee";

const here = dirname(fileURLToPath(import.meta.url));
const surfaceSrc = readFileSync(join(here, "menu-surface.tsx"), "utf8");
const userMenuSrc = readFileSync(join(here, "user-menu.tsx"), "utf8");
const sheetSrc = readFileSync(join(here, "account-sheet.tsx"), "utf8");
const headerSrc = readFileSync(join(here, "messages-app-header.tsx"), "utf8");

describe("shared menu surface instances", () => {
  it("is the one primitive: content + item + separator wrap DropdownMenu*", () => {
    expect(surfaceSrc).toContain("from \"@/components/ui/dropdown-menu\"");
    expect(surfaceSrc).toContain("<DropdownMenuContent");
    expect(surfaceSrc).toContain("<DropdownMenuItem");
    expect(surfaceSrc).toContain("<DropdownMenuSeparator");
    expect(surfaceSrc).toContain("MENU_SURFACE_CONTENT_CLASS");
    expect(surfaceSrc).toContain("MENU_SURFACE_ITEM_CLASS");
    expect(surfaceSrc).toContain("MENU_SURFACE_SEPARATOR_CLASS");
    expect(surfaceSrc).toContain("MENU_SURFACE_ITEM_DANGER_CLASS");
    expect(surfaceSrc).toContain("danger && MENU_SURFACE_ITEM_DANGER_CLASS");
    expect(surfaceSrc).not.toContain("THREAD_POPOVER_CONTENT_CLASS");
    expect(surfaceSrc).not.toContain("THREAD_POPOVER_ITEM_CLASS");
    expect(surfaceSrc).not.toContain("rounded-[12px]");
  });

  it("keeps thread ··· on the shared surface and Identity on the house panel", () => {
    expect(headerSrc).toContain("<ThreadPopoverContent");
    expect(headerSrc).toContain("<ThreadPopoverItem");
    expect(headerSrc).toContain("<ThreadPopoverSeparator");
    expect(surfaceSrc).toContain("<MenuSurfaceContent data-thread-popover=\"\"");
    expect(surfaceSrc).toContain("<MenuSurfaceItem");
    expect(surfaceSrc).toContain("<MenuSurfaceSeparator data-thread-popover-hairline=\"\"");
    expect(userMenuSrc).not.toContain("<DropdownMenuContent");
    expect(userMenuSrc).not.toContain("<DropdownMenuItem");
    expect(userMenuSrc).not.toContain("<DropdownMenuSeparator");
    expect(userMenuSrc).not.toContain("<MenuSurfaceContent");
    expect(headerSrc).not.toContain("<DropdownMenuContent");
    expect(headerSrc).not.toContain("<MenuSurfaceContent");
    expect(sheetSrc).toContain("<MenuSurfaceAccent");
  });

  it("opts the Identity half-bar on and keeps thread ··· off", () => {
    expect(surfaceSrc).toContain("accent = false");
    expect(surfaceSrc).toContain("{accent ? <MenuSurfaceAccent /> : null}");
    expect(surfaceSrc).toContain("<MenuSurfaceContent data-thread-popover=\"\" {...props} accent={false} />");
    expect(sheetSrc).toContain("{face === \"main\" ? <MenuSurfaceAccent /> : null}");
    expect(headerSrc).not.toContain("MenuSurfaceAccent");
    expect(headerSrc).not.toContain("accent={true}");
    expect(headerSrc).not.toContain("accent ");
  });

  it("keeps profile contents on the Identity panel and off the thread menu", () => {
    expect(userMenuSrc).toContain("UserMenuIdentity");
    expect(userMenuSrc).toContain("onUserMenuLogOut");
    expect(sheetSrc).toContain("ACCOUNT_SHEET_ITEMS");
    expect(headerSrc).toContain("ASK_GLOBEE.downloadPdfLabel");
    expect(headerSrc).toContain("ASK_GLOBEE.renameLabel");
    expect(headerSrc).toContain("ASK_GLOBEE.pinLabel");
    expect(headerSrc).toContain("ASK_GLOBEE.deleteLabel");
    expect(headerSrc).not.toContain("UserMenuIdentity");
    expect(headerSrc).not.toContain("data-user-menu-identity");
    expect(headerSrc).not.toContain("USER_MENU_ACTIONS");
    expect(headerSrc).not.toContain("onUserMenuLogOut");
    expect(headerSrc).not.toContain(USER_MENU.agreements);
    expect(headerSrc).not.toContain(USER_MENU.appearance);
    expect(headerSrc).not.toContain(USER_MENU.logOut);
    expect(headerSrc).not.toContain("Agreements");
    expect(headerSrc).not.toContain("Appearance");
    expect(headerSrc).not.toContain("Log out");
    expect(surfaceSrc).not.toContain("UserMenuIdentity");
    expect(surfaceSrc).not.toContain(ASK_GLOBEE.downloadPdfLabel);
  });

  it("puts the delete hairline after Pin; Identity puts Log out between two hairlines", () => {
    const pin = headerSrc.indexOf("ASK_GLOBEE.pinLabel");
    const hairline = headerSrc.indexOf("<ThreadPopoverSeparator");
    const del = headerSrc.indexOf('danger onSelect={() => setDeleteOpen(true)}');
    expect(pin).toBeGreaterThan(-1);
    expect(hairline).toBeGreaterThan(pin);
    expect(del).toBeGreaterThan(hairline);

    const actions = sheetSrc.indexOf("ACCOUNT_SHEET_ITEMS.map");
    const groupClose = sheetSrc.indexOf("</SheetGroup>", actions);
    const logOutAfterItems = sheetSrc.indexOf("<AccountMenuLogOut", groupClose);
    const logoutRule = sheetSrc.indexOf("data-account-sheet-logout-rule");
    const logOutLabel = sheetSrc.indexOf("{USER_MENU.logOut}");
    const footerRule = sheetSrc.indexOf("data-account-sheet-footer-rule");
    expect(logOutAfterItems).toBeGreaterThan(groupClose);
    expect(logoutRule).toBeGreaterThan(-1);
    expect(logoutRule).toBeLessThan(logOutLabel);
    expect(footerRule).toBeGreaterThan(logOutLabel);
    expect(sheetSrc.slice(actions, groupClose)).not.toContain("AccountMenuLogOut");
    expect(sheetSrc).toContain("data-account-sheet-logout-rule");
    expect(sheetSrc).toContain("data-account-sheet-footer-rule");
  });
});
