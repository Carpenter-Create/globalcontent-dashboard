import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SETTINGS } from "@/lib/settings";
import { HashRedirect } from "./hash-redirect";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

describe("HashRedirect", () => {
  it("renders the leftover door as a no-JS link", () => {
    const profile = renderToStaticMarkup(
      createElement(HashRedirect, { href: SETTINGS.profileHref }),
    );
    const agreements = renderToStaticMarkup(
      createElement(HashRedirect, { href: SETTINGS.agreementsHref }),
    );
    expect(profile).toContain('href="/settings/profile"');
    expect(profile).toContain('data-hash-redirect=""');
    expect(agreements).toContain('href="/settings/agreements"');
    expect(agreements).toContain('data-hash-redirect=""');
  });
});
