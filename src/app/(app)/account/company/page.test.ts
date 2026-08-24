import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/server";
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
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("../actions", () => ({ saveCompanyName: vi.fn() }));

function stubMemberCan(allowed: boolean) {
  const rpc = vi.fn(async (name: string) => {
    if (name !== "member_can") throw new Error(`unexpected rpc(${name})`);
    return { data: allowed, error: null };
  });
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  return rpc;
}

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
    stubMemberCan(true);
    const html = renderToStaticMarkup(await CompanyProfilePage());
    expect(html).toContain(COMPANY_PROFILE.title);
    expect(html).toContain(COMPANY_PROFILE.nameLabel);
    expect(html).toContain("Acme Films");
    expect(html).toContain(COMPANY_PROFILE.save);
    expect(html).toContain('id="company-name"');
  });

  it("is read-only when member_can manage_settings is false", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ role: "delivery_ops", isGcStaff: true }) as never);
    const rpc = stubMemberCan(false);
    const html = renderToStaticMarkup(await CompanyProfilePage());
    expect(rpc).toHaveBeenCalledWith("member_can", {
      p_uid: "u1",
      p_org: "org-1",
      p_capability: "manage_settings",
    });
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

  it("is the same /account/company page on desktop and mobile — not a sheet-only destination", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pageSrc = readFileSync(join(here, "page.tsx"), "utf8");
    const formSrc = readFileSync(join(here, "../company-profile-form.tsx"), "utf8");
    const actionSrc = readFileSync(join(here, "../actions.ts"), "utf8");
    expect(existsSync(join(here, "../profile/page.tsx"))).toBe(false);
    expect(pageSrc).toContain("CompanyProfileForm");
    expect(formSrc).toContain("saveCompanyName");
    expect(formSrc).toContain("orgId");
    expect(actionSrc).toContain('from("organizations")');
    expect(actionSrc).toContain('rpc("member_can"');
    expect(actionSrc).toContain("parsed.data.orgId");
    expect(`${pageSrc}${formSrc}`).not.toMatch(/md:hidden|hidden md:|max-md:/);
    expect(COMPANY_PROFILE.href).toBe("/account/company");
  });
});
