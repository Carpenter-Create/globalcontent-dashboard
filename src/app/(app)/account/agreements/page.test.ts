import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SETTINGS } from "@/lib/settings";
import AccountAgreementsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

const here = dirname(fileURLToPath(import.meta.url));

describe("AccountAgreementsPage", () => {
  it("redirects /account/agreements to /settings#agreements", () => {
    const html = renderToStaticMarkup(createElement(AccountAgreementsPage));
    const pageSrc = readFileSync(join(here, "page.tsx"), "utf8");
    expect(html).toContain(`href="${SETTINGS.agreementsHref}"`);
    expect(html).toContain('data-hash-redirect=""');
    expect(html).toContain("/settings#agreements");
    expect(pageSrc).toContain("SETTINGS.agreementsHref");
    expect(pageSrc).toContain("HashRedirect");
    expect(pageSrc).not.toContain("contract_assents");
    expect(pageSrc).not.toContain("No agreements accepted yet.");
  });
});
