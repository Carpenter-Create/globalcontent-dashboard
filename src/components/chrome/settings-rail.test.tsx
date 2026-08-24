import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/settings/profile" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

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
  it("is ← Dashboard / Profile / Agreements / Refer a friend — 16 chevron + 15 Regular", () => {
    navigation.pathname = "/settings/profile";
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
    expect(html).toContain(SETTINGS.refer);
    expect(html).toContain('href="/settings/profile"');
    expect(html).toContain('href="/settings/agreements"');
    expect(html).toContain('href="/settings/refer"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain(SETTINGS_RAIL_ACTIVE_CLASS);
    expect(src).toContain("settingsSection(usePathname())");
    expect(src).toContain("ChevronLeft");
    expect(src).not.toContain("window.location.hash");
    expect(src).not.toContain("hashchange");
    expect(src).not.toContain("t-body-sm");
    expect(src).not.toContain("SettingsLocalNav");
  });

  it("washes the row that matches the path", () => {
    navigation.pathname = "/settings/agreements";
    const agreements = renderToStaticMarkup(<SettingsRail />);
    expect(agreements).toMatch(
      /data-settings-rail-item="agreements"[^>]*aria-current="page"/,
    );
    expect(agreements).not.toMatch(
      /data-settings-rail-item="profile"[^>]*aria-current="page"/,
    );
    expect(agreements).not.toMatch(
      /data-settings-rail-item="refer"[^>]*aria-current="page"/,
    );

    navigation.pathname = "/settings/refer";
    const refer = renderToStaticMarkup(<SettingsRail />);
    expect(refer).toMatch(/data-settings-rail-item="refer"[^>]*aria-current="page"/);
    expect(refer).not.toMatch(
      /data-settings-rail-item="agreements"[^>]*aria-current="page"/,
    );
  });

  it("does not invent Account / Users / API or the Access destinations", () => {
    navigation.pathname = "/settings/profile";
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
