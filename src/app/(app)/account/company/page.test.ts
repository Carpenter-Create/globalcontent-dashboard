import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrgContext } from "@/lib/supabase/context";
import { COMPANY_PROFILE } from "@/lib/account-profile";
import CompanyProfilePage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  useRouter: () => ({ refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("../actions", () => ({ saveCompanyName: vi.fn() }));

function ctx({
  role = "account_owner",
  isGcStaff = false,
  hasOrg = true,
  orgName = "Acme Films",
}: {
  role?: string;
  isGcStaff?: boolean;
  hasOrg?: boolean;
  orgName?: string;
} = {}) {
  const org = hasOrg ? { id: "org-1", name: orgName, status: "active" } : null;
  return {
    user: { id: "u1", email: "ada@example.com", name: "Ada" },
    rows: org ? [{ role, organizations: org }] : [],
    orgs: org ? [{ id: org.id, name: org.name }] : [],
    activeOrg: org,
    activeRole: org ? role : null,
    canOperate: role === "account_owner" || role === "delivery_ops",
    isGcStaff,
    unread: Promise.resolve(0),
  };
}

describe("CompanyProfilePage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the existing organizations.name and a save control for the owner", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    const html = renderToStaticMarkup(createElement(await CompanyProfilePage()));
    expect(html).toContain(COMPANY_PROFILE.title);
    expect(html).toContain(COMPANY_PROFILE.nameLabel);
    expect(html).toContain("Acme Films");
    expect(html).toContain(COMPANY_PROFILE.save);
    expect(html).toContain('id="company-name"');
  });

  it("is read-only for delivery_ops", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ role: "delivery_ops" }) as never);
    const html = renderToStaticMarkup(createElement(await CompanyProfilePage()));
    expect(html).toContain("Acme Films");
    expect(html).toContain(COMPANY_PROFILE.forbidden);
    expect(html).not.toContain(`>${COMPANY_PROFILE.save}<`);
  });

  it("sends an unauthenticated visitor to login", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    await expect(CompanyProfilePage()).rejects.toThrow("REDIRECT:/login");
  });

  it("sends a user with no active org home", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ hasOrg: false, isGcStaff: true }) as never);
    await expect(CompanyProfilePage()).rejects.toThrow("REDIRECT:/");
  });
});
