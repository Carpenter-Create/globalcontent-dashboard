import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SETTINGS,
  SETTINGS_LOCAL_NAV,
  SETTINGS_RAIL_ABSENT,
  SETTINGS_RAIL_ACTIVE_CLASS,
  SETTINGS_RAIL_CHEVRON_CLASS,
  SETTINGS_RAIL_ITEM_CLASS,
  SETTINGS_RAIL_NAV_CLASS,
} from "@/lib/settings";
import { SettingsRail } from "./settings-rail";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "settings-rail.tsx"), "utf8");

describe("SettingsRail", () => {
  it("is ← Dashboard / Profile / Agreements — 16 chevron + 15 Regular", () => {
    const html = renderToStaticMarkup(<SettingsRail />);
    expect(html).toContain('data-settings-rail-nav=""');
    expect(html).toContain(SETTINGS_RAIL_NAV_CLASS);
    for (const item of SETTINGS_LOCAL_NAV) {
      expect(html).toContain(`data-settings-rail-item="${item.kind}"`);
      expect(html).toContain(`href="${item.href}"`);
      expect(html).toContain(item.label);
    }
    expect(html).toContain(SETTINGS_RAIL_ITEM_CLASS);
    expect(html).toContain(SETTINGS_RAIL_CHEVRON_CLASS);
    expect(html).toContain('stroke-width="1.33"');
    expect(html).toContain(SETTINGS.dashboard);
    expect(html).toContain(SETTINGS.profile);
    expect(html).toContain(SETTINGS.agreements);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(SETTINGS_RAIL_ACTIVE_CLASS);
    expect(src).toContain("settingsSection(window.location.hash)");
    expect(src).toContain("hashchange");
    expect(src).toContain("ChevronLeft");
    expect(src).not.toContain("t-body-sm");
    expect(src).not.toContain("SettingsLocalNav");
  });

  it("does not invent Account / Users / API or the Access destinations", () => {
    const html = renderToStaticMarkup(<SettingsRail />);
    for (const absent of SETTINGS_RAIL_ABSENT) {
      expect(html).not.toContain(absent);
    }
    expect(html).not.toContain("GLOBAL CONTENT");
    expect(src).not.toContain("GC_NAV");
    expect(src).not.toContain("@/lib/nav");
    expect(src).not.toContain("accent");
    expect(src).not.toContain("purple");
  });
});
