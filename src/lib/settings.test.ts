import { describe, expect, it } from "vitest";

import { USER_MENU, USER_MENU_ACTIONS } from "./user-menu";
import {
  SETTINGS,
  SETTINGS_ABSENT,
  SETTINGS_LOCAL_NAV,
  settingsHref,
  settingsPath,
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
  });
});
