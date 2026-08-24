import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MENU_SURFACE_ACCENT_CLASS,
  MENU_SURFACE_ACCENT_CLIP_CLASS,
  MENU_SURFACE_CONTENT_CLASS,
  MENU_SURFACE_ITEM_CLASS,
  MENU_SURFACE_ITEM_DANGER_CLASS,
  MENU_SURFACE_SEPARATOR_CLASS,
} from "./menu-surface";

const here = dirname(fileURLToPath(import.meta.url));

describe("menu surface chrome lock", () => {
  it("keeps one content / item / separator register", () => {
    expect(MENU_SURFACE_CONTENT_CLASS).toBe(
      "min-w-[17.5rem] rounded-[var(--radius)] p-[var(--space-2)]",
    );
    expect(MENU_SURFACE_ITEM_CLASS).toBe(
      "rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)] t-body-sm text-ink-2",
    );
    expect(MENU_SURFACE_SEPARATOR_CLASS).toBe("my-[var(--space-2)]");
    expect(MENU_SURFACE_ITEM_DANGER_CLASS).toBe(
      "text-[#c4564a] data-[highlighted]:text-[#c4564a]",
    );
    expect(MENU_SURFACE_ITEM_DANGER_CLASS).not.toContain("font-bold");
    expect(MENU_SURFACE_ITEM_DANGER_CLASS).not.toContain("bg-");
  });

  it("locks the Identity half-bar to left-origin 50% 4px Sporty Blue with no track", () => {
    expect(MENU_SURFACE_ACCENT_CLASS).toBe(
      "pointer-events-none absolute left-0 top-0 h-[4px] w-1/2 bg-accent",
    );
    expect(MENU_SURFACE_ACCENT_CLASS).not.toContain("w-full");
    expect(MENU_SURFACE_ACCENT_CLASS).not.toContain("bg-hairline");
    expect(MENU_SURFACE_ACCENT_CLASS).not.toContain("bg-surface-muted");
    expect(MENU_SURFACE_ACCENT_CLASS).not.toContain("#1769");
    expect(MENU_SURFACE_ACCENT_CLIP_CLASS).toContain("overflow-hidden");
    expect(MENU_SURFACE_ACCENT_CLIP_CLASS).not.toContain("bg-");
  });

  it("does not put the half-bar on / or any dashboard card", () => {
    const dashboard = readFileSync(
      join(here, "../components/dashboard/dashboard-home.tsx"),
      "utf8",
    );
    const page = readFileSync(join(here, "../app/(app)/page.tsx"), "utf8");
    const card = readFileSync(join(here, "../components/ui/card.tsx"), "utf8");
    expect(dashboard).not.toContain("MENU_SURFACE_ACCENT");
    expect(dashboard).not.toContain("data-menu-surface-accent");
    expect(dashboard).not.toContain("MenuSurfaceAccent");
    expect(page).not.toContain("MENU_SURFACE_ACCENT");
    expect(page).not.toContain("data-menu-surface-accent");
    expect(page).not.toContain("MenuSurfaceAccent");
    expect(card).not.toContain("MENU_SURFACE_ACCENT");
    expect(card).not.toContain("data-menu-surface-accent");
    expect(card).not.toContain("h-[4px] w-1/2");
  });

  it("forbids a forked THREAD_POPOVER_* surface lookalike", () => {
    const houseSheet = readFileSync(join(here, "house-sheet.ts"), "utf8");
    const house = readFileSync(join(here, "../components/chrome/house.tsx"), "utf8");
    const header = readFileSync(
      join(here, "../components/chrome/messages-app-header.tsx"),
      "utf8",
    );
    const userMenu = readFileSync(join(here, "../components/chrome/user-menu.tsx"), "utf8");

    expect(houseSheet).not.toContain("THREAD_POPOVER_CONTENT_CLASS");
    expect(houseSheet).not.toContain("THREAD_POPOVER_ITEM_CLASS");
    expect(houseSheet).not.toContain("THREAD_POPOVER_DELETE_CLASS");
    expect(houseSheet).not.toContain("rounded-[12px]");
    expect(houseSheet).not.toContain("shadow-none");
    expect(houseSheet).not.toContain("min-w-[17.5rem]");
    expect(house).not.toContain("THREAD_POPOVER_CONTENT_CLASS");
    expect(house).not.toContain("DropdownMenuPrimitive");
    expect(header).not.toContain("min-w-[17.5rem]");
    expect(header).not.toContain("USER_MENU_ITEM_CLASS");
    expect(userMenu).not.toContain("min-w-[17.5rem]");
    expect(userMenu).not.toContain("USER_MENU_ITEM_CLASS");
    expect(userMenu).not.toContain("USER_MENU_RULE_CLASS");
  });
});
