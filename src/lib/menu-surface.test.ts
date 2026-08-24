import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
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
