import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HOUSE_EMPTY_CLASS } from "@/lib/house-sheet";
import { SETTINGS, SETTINGS_ABSENT } from "@/lib/settings";
import SettingsAgreementsPage from "./page";

const here = dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(join(here, "page.tsx"), "utf8");

describe("SettingsAgreementsPage", () => {
  it("houses Agreements empty and does not invent a listing or Company", () => {
    const html = renderToStaticMarkup(createElement(SettingsAgreementsPage));
    expect(html).toContain('data-settings-page=""');
    expect(html).toContain('data-settings-section="agreements"');
    expect(html).toContain(SETTINGS.agreements);
    expect(html).toContain(SETTINGS.agreementsEmpty);
    expect(html).toContain(HOUSE_EMPTY_CLASS);
    expect(html).toContain("data-house-empty");
    expect(html).not.toContain('data-settings-section="profile"');
    expect(html).not.toContain("AccountProfileForm");
    expect(html).not.toContain("No agreements accepted yet.");
    expect(html).not.toContain("Download");
    expect(html).not.toContain("View agreement text");
    expect(html).not.toContain("contract_assents");
    expect(html).not.toContain("md:w-[220px]");
    expect(pageSrc).not.toContain("SettingsRail");
    expect(pageSrc).not.toContain("S3_AVATARS_BUCKET");
    for (const absent of SETTINGS_ABSENT) {
      expect(html).not.toContain(absent);
    }
  });
});
