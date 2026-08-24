import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { SETTINGS } from "@/lib/settings";
import AccountAgreementsPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

const here = dirname(fileURLToPath(import.meta.url));

describe("AccountAgreementsPage", () => {
  it("redirects /account/agreements to /settings/agreements", () => {
    const pageSrc = readFileSync(join(here, "page.tsx"), "utf8");
    expect(() => AccountAgreementsPage()).toThrow(`REDIRECT:${SETTINGS.agreementsHref}`);
    expect(pageSrc).toContain("SETTINGS.agreementsHref");
    expect(pageSrc).toContain("redirect");
    expect(pageSrc).not.toContain("contract_assents");
    expect(pageSrc).not.toContain("No agreements accepted yet.");
  });
});
