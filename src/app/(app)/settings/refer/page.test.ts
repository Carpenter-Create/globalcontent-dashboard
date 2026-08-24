import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HOUSE_EMPTY_CLASS } from "@/lib/house-sheet";
import { REFER } from "@/lib/refer";
import { SETTINGS } from "@/lib/settings";
import SettingsReferPage from "./page";

const here = dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(join(here, "page.tsx"), "utf8");

describe("SettingsReferPage", () => {
  it("houses Refer a friend empty and does not invent a referral product", () => {
    const html = renderToStaticMarkup(createElement(SettingsReferPage));
    expect(html).toContain('data-settings-page=""');
    expect(html).toContain('data-settings-section="refer"');
    expect(html).toContain(SETTINGS.refer);
    expect(html).toContain(REFER.empty);
    expect(html).toContain("Refer a friend is empty.");
    expect(html).toContain(HOUSE_EMPTY_CLASS);
    expect(html).toContain("data-house-empty");
    expect(html).not.toContain('data-settings-section="profile"');
    expect(html).not.toContain('data-settings-section="agreements"');
    expect(html).not.toContain("reward");
    expect(html).not.toContain("Share a link");
    expect(html).not.toContain("Phone");
    expect(html).not.toContain("Job");
    expect(html).not.toContain("md:w-[220px]");
    expect(pageSrc).not.toContain("SettingsRail");
    expect(pageSrc).not.toContain("S3_AVATARS_BUCKET");
  });
});
