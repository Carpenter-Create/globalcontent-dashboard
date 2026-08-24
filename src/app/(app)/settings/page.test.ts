import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { SETTINGS } from "@/lib/settings";
import SettingsPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

const here = dirname(fileURLToPath(import.meta.url));

describe("SettingsPage", () => {
  it("redirects /settings to /settings/profile", () => {
    const pageSrc = readFileSync(join(here, "page.tsx"), "utf8");
    expect(() => SettingsPage()).toThrow(`REDIRECT:${SETTINGS.profileHref}`);
    expect(pageSrc).toContain("SETTINGS.profileHref");
    expect(pageSrc).toContain("redirect");
    expect(pageSrc).not.toContain("AccountProfileForm");
    expect(pageSrc).not.toContain("data-settings-section");
    expect(pageSrc).not.toContain("HouseEmpty");
  });
});
