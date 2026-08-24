import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrgContext } from "@/lib/supabase/context";
import { ACCOUNT_PROFILE } from "@/lib/account-profile";
import AccountPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  useRouter: () => ({ refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("./actions", () => ({ saveAccountName: vi.fn() }));

function ctx(name: string | null, email = "ada@example.com") {
  return {
    user: { id: "u1", email, name },
    rows: [{ role: "account_owner", organizations: { id: "org-1", name: "Acme", status: "active" } }],
    orgs: [{ id: "org-1", name: "Acme" }],
    activeOrg: { id: "org-1", name: "Acme", status: "active" },
    activeRole: "account_owner",
    canOperate: true,
    isGcStaff: false,
    unread: Promise.resolve(0),
  };
}

describe("AccountPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders name and email from the session user — empty name stays empty", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null) as never);
    const html = renderToStaticMarkup(createElement(await AccountPage()));
    expect(html).toContain(ACCOUNT_PROFILE.title);
    expect(html).toContain(ACCOUNT_PROFILE.nameLabel);
    expect(html).toContain(ACCOUNT_PROFILE.emailLabel);
    expect(html).toContain("ada@example.com");
    expect(html).toContain(ACCOUNT_PROFILE.emailHint);
    expect(html).toContain('id="account-name"');
    expect(html).toContain('id="account-email"');
    expect(html).toContain("readOnly");
    expect(html).not.toContain("Jane Doe");
    expect(html).not.toContain("ada</");
  });

  it("fills a real display name when the session already has one", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx("Ada Lovelace") as never);
    const html = renderToStaticMarkup(createElement(await AccountPage()));
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
  });

  it("does not invent a name from the email local-part", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null, "jane.doe@studio.com") as never);
    const html = renderToStaticMarkup(createElement(await AccountPage()));
    expect(html).toContain("jane.doe@studio.com");
    expect(html).not.toContain("Jane Doe");
    expect(html).not.toContain('value="jane.doe"');
  });

  it("sends an unauthenticated visitor to login", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    await expect(AccountPage()).rejects.toThrow("REDIRECT:/login");
  });
});
