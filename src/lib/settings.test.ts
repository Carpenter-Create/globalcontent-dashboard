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
  settingsRailActive,
  settingsSection,
} from "./settings";

describe("settings lock", () => {
  it("keeps /settings/profile, /settings/agreements, and /settings/refer", () => {
    expect(SETTINGS.href).toBe("/settings");
    expect(SETTINGS.profile).toBe("Profile");
    expect(SETTINGS.profileHref).toBe("/settings/profile");
    expect(SETTINGS.agreements).toBe("Agreements");
    expect(SETTINGS.agreementsHref).toBe("/settings/agreements");
    expect(SETTINGS.agreementsEmpty).toBe("No agreements on this account.");
    expect(SETTINGS.refer).toBe("Refer a friend");
    expect(SETTINGS.referHref).toBe("/settings/refer");
    expect(SETTINGS.dashboard).toBe("Dashboard");
    expect(SETTINGS.dashboardHref).toBe("/");
    expect(SETTINGS.profileHref).toBe(USER_MENU.profileHref);
    expect(SETTINGS.agreementsHref).toBe(USER_MENU.agreementsHref);
    expect(SETTINGS.referHref).toBe(USER_MENU.referHref);
    expect(SETTINGS).not.toHaveProperty("profileHash");
    expect(SETTINGS).not.toHaveProperty("agreementsHash");
  });

  it("opens a section from the path", () => {
    expect(settingsSection("/settings/profile")).toBe("profile");
    expect(settingsSection("/settings")).toBe("profile");
    expect(settingsSection("/settings/agreements")).toBe("agreements");
    expect(settingsSection("/settings/refer")).toBe("refer");
    expect(settingsSection("")).toBe("profile");
    expect(settingsSection(null)).toBe("profile");
  });

  it("keeps local nav to Dashboard / Profile / Agreements / Refer a friend", () => {
    expect(SETTINGS_LOCAL_NAV.map((item) => item.label)).toEqual([
      "Dashboard",
      "Profile",
      "Agreements",
      "Refer a friend",
    ]);
    expect(SETTINGS_LOCAL_NAV.map((item) => item.href)).toEqual([
      "/",
      "/settings/profile",
      "/settings/agreements",
      "/settings/refer",
    ]);
    expect(SETTINGS_LOCAL_NAV.map((item) => item.kind)).toEqual([
      "dashboard",
      "profile",
      "agreements",
      "refer",
    ]);
  });

  it("does not invent Phone, Job, Company, or the old email helper", () => {
    const blob = `${SETTINGS.profile} ${SETTINGS.agreements} ${SETTINGS.agreementsEmpty} ${SETTINGS.refer}`;
    for (const absent of SETTINGS_ABSENT) {
      expect(blob).not.toContain(absent);
    }
    expect(SETTINGS.agreementsEmpty).not.toMatch(/accepted yet|download|view agreement/i);
    expect(USER_MENU_ACTIONS.map((item) => item.kind)).not.toContain("settings");
  });

  it("treats every /settings path as the focused shell", () => {
    expect(isSettingsPath("/settings")).toBe(true);
    expect(isSettingsPath("/settings/profile")).toBe(true);
    expect(isSettingsPath("/settings/agreements")).toBe(true);
    expect(isSettingsPath("/settings/refer")).toBe(true);
    expect(isSettingsPath("/")).toBe(false);
    expect(isSettingsPath("/titles")).toBe(false);
    expect(isSettingsPath("/help")).toBe(false);
    expect(isSettingsPath("/refer")).toBe(false);
  });

  it("washes the current path and never marks Dashboard current", () => {
    expect(settingsRailActive("profile", "profile")).toBe(true);
    expect(settingsRailActive("agreements", "agreements")).toBe(true);
    expect(settingsRailActive("refer", "refer")).toBe(true);
    expect(settingsRailActive("profile", "agreements")).toBe(false);
    expect(settingsRailActive("agreements", "refer")).toBe(false);
    expect(settingsRailActive("dashboard", "profile")).toBe(false);
    expect(settingsRailActive("dashboard", "agreements")).toBe(false);
    expect(settingsRailActive("dashboard", "refer")).toBe(false);
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
