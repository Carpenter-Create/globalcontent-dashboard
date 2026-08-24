import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { USER_MENU } from "@/lib/user-menu";
import { ASK_GLOBEE } from "@/lib/ask-globee";

const here = dirname(fileURLToPath(import.meta.url));
const surfaceSrc = readFileSync(join(here, "menu-surface.tsx"), "utf8");
const userMenuSrc = readFileSync(join(here, "user-menu.tsx"), "utf8");
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

  it("lets desktop profile and thread ··· instance the same surface", () => {
    expect(userMenuSrc).toContain("<MenuSurfaceContent");
    expect(userMenuSrc).toContain("<MenuSurfaceItem");
    expect(userMenuSrc).toContain("<MenuSurfaceSeparator");
    expect(userMenuSrc).toContain('data-user-menu=""');
    expect(headerSrc).toContain("<ThreadPopoverContent");
    expect(headerSrc).toContain("<ThreadPopoverItem");
    expect(headerSrc).toContain("<ThreadPopoverSeparator");
    expect(surfaceSrc).toContain("<MenuSurfaceContent data-thread-popover=\"\"");
    expect(surfaceSrc).toContain("<MenuSurfaceItem");
    expect(surfaceSrc).toContain("<MenuSurfaceSeparator data-thread-popover-hairline=\"\"");
    expect(userMenuSrc).not.toContain("<DropdownMenuContent");
    expect(userMenuSrc).not.toContain("<DropdownMenuItem");
    expect(userMenuSrc).not.toContain("<DropdownMenuSeparator");
    expect(headerSrc).not.toContain("<DropdownMenuContent");
    expect(headerSrc).not.toContain("<MenuSurfaceContent");
  });

  it("keeps profile contents on the surface and off the thread menu", () => {
    expect(userMenuSrc).toContain("UserMenuIdentity");
    expect(userMenuSrc).toContain("USER_MENU.agreements");
    expect(userMenuSrc).toContain("USER_MENU.appearance");
    expect(userMenuSrc).toContain("USER_MENU.logOut");
    expect(headerSrc).toContain("ASK_GLOBEE.downloadPdfLabel");
    expect(headerSrc).toContain("ASK_GLOBEE.renameLabel");
    expect(headerSrc).toContain("ASK_GLOBEE.pinLabel");
    expect(headerSrc).toContain("ASK_GLOBEE.deleteLabel");
    expect(headerSrc).not.toContain("UserMenuIdentity");
    expect(headerSrc).not.toContain("data-user-menu-identity");
    expect(headerSrc).not.toContain("USER_MENU.agreements");
    expect(headerSrc).not.toContain("USER_MENU.appearance");
    expect(headerSrc).not.toContain("USER_MENU.logOut");
    expect(headerSrc).not.toContain(USER_MENU.agreements);
    expect(headerSrc).not.toContain(USER_MENU.appearance);
    expect(headerSrc).not.toContain(USER_MENU.logOut);
    expect(headerSrc).not.toContain("Agreements");
    expect(headerSrc).not.toContain("Appearance");
    expect(headerSrc).not.toContain("Log out");
    expect(surfaceSrc).not.toContain("UserMenuIdentity");
    expect(surfaceSrc).not.toContain(ASK_GLOBEE.downloadPdfLabel);
  });

  it("puts the delete hairline after Pin, same grouping rule as logout", () => {
    const pin = headerSrc.indexOf("ASK_GLOBEE.pinLabel");
    const hairline = headerSrc.indexOf("<ThreadPopoverSeparator");
    const del = headerSrc.indexOf('danger onSelect={() => setDeleteOpen(true)}');
    expect(pin).toBeGreaterThan(-1);
    expect(hairline).toBeGreaterThan(pin);
    expect(del).toBeGreaterThan(hairline);

    const appearance = userMenuSrc.indexOf('data-user-menu-item="appearance"');
    const logoutRule = userMenuSrc.indexOf('data-user-menu-logout-hairline=""');
    const logOut = userMenuSrc.indexOf('data-user-menu-item="logOut"');
    expect(logoutRule).toBeGreaterThan(appearance);
    expect(logOut).toBeGreaterThan(logoutRule);
  });
});
