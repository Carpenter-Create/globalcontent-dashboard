import { describe, expect, it } from "vitest";

import { USER_MENU, USER_MENU_ACTIONS } from "./user-menu";
import {
  SETTINGS,
  SETTINGS_ABSENT,
  SETTINGS_LOCAL_NAV,
  SETTINGS_RAIL_ABSENT,
  SETTINGS_RAIL_ACTIVE_CLASS,
  SETTINGS_RAIL_CHEVRON_CLASS,
  SETTINGS_RAIL_ITEM_CLASS,
  SETTINGS_RAIL_PAD_CLASS,
  isSettingsPath,
  settingsHref,
  settingsPath,
  settingsRailActive,
  settingsSection,
} from "./settings";

describe("settings lock", () => {
  it("keeps /settings with #profile and #agreements only", () => {
    expect(SETTINGS.href).toBe("/settings");
    expect(SETTINGS.profile).toBe("Profile");
    expect(SETTINGS.profileHash).toBe("profile");
    expect(SETTINGS.profileHref).toBe("/settings#profile");
    expect(SETTINGS.agreements).toBe("Agreements");
    expect(SETTINGS.agreementsHash).toBe("agreements");
    expect(SETTINGS.agreementsHref).toBe("/settings#agreements");
    expect(SETTINGS.agreementsEmpty).toBe("No agreements on this account.");
    expect(SETTINGS.dashboard).toBe("Dashboard");
    expect(SETTINGS.dashboardHref).toBe("/");
    expect(SETTINGS.profileHref).toBe(USER_MENU.profileHref);
    expect(SETTINGS.agreementsHref).toBe(USER_MENU.agreementsHref);
    expect(settingsHref(SETTINGS.profileHash)).toBe("/settings#profile");
    expect(settingsHref(SETTINGS.agreementsHash)).toBe("/settings#agreements");
  });

  it("opens Profile unless the hash is #agreements", () => {
    expect(settingsSection("")).toBe("profile");
    expect(settingsSection("#")).toBe("profile");
    expect(settingsSection("#profile")).toBe("profile");
    expect(settingsSection("profile")).toBe("profile");
    expect(settingsSection("#agreements")).toBe("agreements");
    expect(settingsSection("agreements")).toBe("agreements");
    expect(settingsSection("#appearance")).toBe("profile");
    expect(settingsSection(null)).toBe("profile");
  });

  it("keeps local nav to Dashboard / Profile / Agreements", () => {
    expect(SETTINGS_LOCAL_NAV.map((item) => item.label)).toEqual([
      "Dashboard",
      "Profile",
      "Agreements",
    ]);
    expect(SETTINGS_LOCAL_NAV.map((item) => item.href)).toEqual([
      "/",
      "/settings#profile",
      "/settings#agreements",
    ]);
    expect(SETTINGS_LOCAL_NAV.map((item) => item.kind)).toEqual([
      "dashboard",
      "profile",
      "agreements",
    ]);
  });

  it("does not invent Phone, Job, Company, or the old email helper", () => {
    const blob = `${SETTINGS.profile} ${SETTINGS.agreements} ${SETTINGS.agreementsEmpty}`;
    for (const absent of SETTINGS_ABSENT) {
      expect(blob).not.toContain(absent);
    }
    expect(SETTINGS.agreementsEmpty).not.toMatch(/accepted yet|download|view agreement/i);
    expect(USER_MENU_ACTIONS.map((item) => item.kind)).not.toContain("settings");
  });

  it("strips the hash when comparing a settings door to a pathname", () => {
    expect(settingsPath("/settings#profile")).toBe("/settings");
    expect(settingsPath("/settings#agreements")).toBe("/settings");
    expect(settingsPath("/help")).toBe("/help");
    expect(isSettingsPath("/settings")).toBe(true);
    expect(isSettingsPath("/settings#agreements")).toBe(true);
    expect(isSettingsPath("/")).toBe(false);
    expect(isSettingsPath("/titles")).toBe(false);
  });

  it("washes Profile / Agreements from the hash and never marks Dashboard current", () => {
    expect(settingsRailActive("profile", "profile")).toBe(true);
    expect(settingsRailActive("agreements", "agreements")).toBe(true);
    expect(settingsRailActive("profile", "agreements")).toBe(false);
    expect(settingsRailActive("dashboard", "profile")).toBe(false);
    expect(settingsRailActive("dashboard", "agreements")).toBe(false);
  });

  it("locks the settings rail on 220 pad 16, 15 Regular, and 16 chevron", () => {
    expect(SETTINGS_RAIL_PAD_CLASS).toBe("p-[var(--space-4)]");
    expect(SETTINGS_RAIL_ITEM_CLASS).toContain("t-body");
    expect(SETTINGS_RAIL_ITEM_CLASS).toContain("font-normal");
    expect(SETTINGS_RAIL_ITEM_CLASS).not.toContain("t-body-sm");
    expect(SETTINGS_RAIL_CHEVRON_CLASS).toBe("size-4 shrink-0");
    expect(SETTINGS_RAIL_ACTIVE_CLASS).toContain("bg-surface-muted");
    expect(SETTINGS_RAIL_ACTIVE_CLASS).not.toMatch(/accent|purple|blue/);
    expect(SETTINGS_RAIL_ABSENT).toEqual([
      "Titles",
      "Deliveries",
      "Catalog Health",
      "Ask Globee",
      "Queue",
      "Vendors",
      "Clients",
      "Account",
      "Users",
      "API",
      "Appearance",
      "Company",
    ]);
  });
});
