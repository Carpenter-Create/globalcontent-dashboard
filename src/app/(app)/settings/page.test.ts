import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SETTINGS } from "@/lib/settings";
import SettingsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

const here = dirname(fileURLToPath(import.meta.url));

describe("SettingsPage", () => {
  it("sends /settings and leftover hashes to their path doors", () => {
    const html = renderToStaticMarkup(createElement(SettingsPage));
    const pageSrc = readFileSync(join(here, "page.tsx"), "utf8");
    const redirectSrc = readFileSync(join(here, "settings-index-redirect.tsx"), "utf8");
    expect(html).toContain(`href="${SETTINGS.profileHref}"`);
    expect(html).toContain('data-hash-redirect=""');
    expect(html).toContain("/settings/profile");
    expect(pageSrc).toContain("SettingsIndexRedirect");
    expect(redirectSrc).toContain("settingsHashDestination");
    expect(redirectSrc).toContain("window.location.hash");
    expect(pageSrc).not.toContain("AccountProfileForm");
    expect(pageSrc).not.toContain("data-settings-section");
    expect(pageSrc).not.toContain("HouseEmpty");
  });
});
