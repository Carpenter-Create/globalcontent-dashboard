import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SETTINGS,
  SETTINGS_HEADER_BACK_CLASS,
  SETTINGS_HEADER_PAD_CLASS,
  SETTINGS_RAIL_CHEVRON_CLASS,
} from "@/lib/settings";
import { SettingsHeaderBack } from "./settings-header-back";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "settings-header-back.tsx"),
  "utf8",
);
const shellSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "app-shell.tsx"),
  "utf8",
);
const accountSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "account-sheet.tsx"),
  "utf8",
);
const railSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "settings-rail.tsx"),
  "utf8",
);

describe("SettingsHeaderBack", () => {
  it("is 16 chevron-left + Dashboard 15 Regular, gap 8, href /", () => {
    const html = renderToStaticMarkup(<SettingsHeaderBack />);
    expect(html).toContain('data-settings-header-back=""');
    expect(html).toContain(`href="${SETTINGS.dashboardHref}"`);
    expect(html).toContain(SETTINGS.dashboard);
    expect(html).toContain(SETTINGS_HEADER_BACK_CLASS);
    expect(html).toContain(SETTINGS_RAIL_CHEVRON_CLASS);
    expect(html).toContain('stroke-width="1.33"');
    expect(html).toContain("lucide-chevron-left");
    expect(SETTINGS.dashboardHref).toBe("/");
    expect(SETTINGS_HEADER_BACK_CLASS).toContain("gap-[var(--space-2)]");
    expect(SETTINGS_HEADER_BACK_CLASS).toContain("t-body");
    expect(SETTINGS_HEADER_BACK_CLASS).toContain("font-normal");
    expect(SETTINGS_HEADER_BACK_CLASS).toContain("md:hidden");
    expect(SETTINGS_HEADER_PAD_CLASS).toBe("px-[var(--space-6)]");
    expect(SETTINGS_RAIL_CHEVRON_CLASS).toBe("size-4 shrink-0");
    expect(src).toContain("ChevronLeft");
    expect(src).toContain("SETTINGS.dashboardHref");
    expect(src).toContain("SETTINGS.dashboard");
    expect(src).not.toContain("Menu");
    expect(src).not.toContain("MobileNav");
    expect(src).not.toContain("hamburger");
    expect(src).not.toContain("t-body-sm");
    expect(src).not.toContain("t-title");
    expect(src).not.toContain("Company");
  });

  it("is the same / back as the 600:881 rail, not a new IA", () => {
    expect(src).toContain("600:881");
    expect(src).toContain("623:785");
    expect(src).not.toContain("SettingsLocalNav");
    expect(src).not.toContain("SETTINGS_LOCAL_NAV");
    expect(src).not.toContain("/settings/profile");
    expect(src).not.toContain("/settings/agreements");
    expect(src).not.toContain("/settings/refer");
    expect(src).not.toContain("Appearance");
    expect(shellSrc).toContain("<SettingsHeaderBack />");
    expect(shellSrc).toContain(SETTINGS_HEADER_PAD_CLASS);
    expect(shellSrc).toContain("settingsPage ? <SettingsHeaderBack /> : <MobileNav isGcStaff={isGcStaff} />");
    expect(accountSrc).toContain("flex h-8 w-8 items-center justify-center rounded-full");
    expect(accountSrc).toContain("md:hidden");
    expect(railSrc).toContain("600:881");
    expect(railSrc).toContain("SETTINGS_LOCAL_NAV");
    expect(railSrc).not.toContain("SettingsHeaderBack");
    expect(railSrc).not.toContain("623:785");
  });
});
