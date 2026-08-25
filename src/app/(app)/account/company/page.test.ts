import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { SETTINGS } from "@/lib/settings";
import { COMPANY_PROFILE } from "@/lib/account-profile";
import CompanyProfilePage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

const here = dirname(fileURLToPath(import.meta.url));

describe("CompanyProfilePage", () => {
  it("redirects /account/company to /settings/profile", () => {
    const pageSrc = readFileSync(join(here, "page.tsx"), "utf8");
    expect(() => CompanyProfilePage()).toThrow(`REDIRECT:${SETTINGS.profileHref}`);
    expect(pageSrc).toContain("SETTINGS.profileHref");
    expect(pageSrc).toContain("redirect");
    expect(pageSrc).not.toContain("CompanyProfileForm");
    expect(pageSrc).not.toContain("PageHeader");
    expect(pageSrc).not.toContain("subtitle");
    expect(COMPANY_PROFILE.href).toBe("/account/company");
  });
});
