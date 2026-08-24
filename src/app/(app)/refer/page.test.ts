import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { REFER } from "@/lib/refer";
import ReferPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

const here = dirname(fileURLToPath(import.meta.url));

describe("ReferPage", () => {
  it("redirects /refer to /settings/refer and does not invent a referral product", () => {
    const pageSrc = readFileSync(join(here, "page.tsx"), "utf8");
    expect(() => ReferPage()).toThrow(`REDIRECT:${REFER.href}`);
    expect(pageSrc).toContain("REFER.href");
    expect(pageSrc).toContain("redirect");
    expect(pageSrc).not.toContain("HouseEmpty");
    expect(pageSrc).not.toContain("reward");
    expect(pageSrc).not.toContain("Share a link");
  });
});
