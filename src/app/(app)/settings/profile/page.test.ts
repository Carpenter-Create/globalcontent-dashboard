import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrgContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { signedAvatarUrl } from "@/lib/s3-avatars";
import {
  ACCOUNT_FIELD_CLASS,
  ACCOUNT_PROFILE,
  ACCOUNT_PHOTO_CIRCLE_CLASS,
  COMPANY_PROFILE,
} from "@/lib/account-profile";
import { TEXT_ACTION_CLASS } from "@/lib/house-sheet";
import { SETTINGS, SETTINGS_ABSENT, SETTINGS_LOCAL_NAV } from "@/lib/settings";
import SettingsProfilePage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  useRouter: () => ({ refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings/profile",
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/s3-avatars", () => ({ signedAvatarUrl: vi.fn() }));
vi.mock("../../account/actions", () => ({
  saveAccountName: vi.fn(),
  uploadAccountPhoto: vi.fn(),
  saveCompanyName: vi.fn(),
}));

function stubMemberCan(allowed: boolean) {
  const rpc = vi.fn(async (name: string) => {
    if (name !== "member_can") throw new Error(`unexpected rpc(${name})`);
    return { data: allowed, error: null };
  });
  vi.mocked(createClient).mockResolvedValue({ rpc } as never);
  return rpc;
}

function ctx(name: string | null, email = "ada@example.com", hasOrg = true) {
  const org = hasOrg ? { id: "org-1", name: "Acme", status: "active" } : null;
  return {
    user: { id: "u1", email, name },
    rows: org ? [{ role: "account_owner", organizations: org }] : [],
    orgs: org ? [{ id: org.id, name: org.name }] : [],
    activeOrg: org,
    activeRole: org ? "account_owner" : null,
    canOperate: true,
    isGcStaff: false,
    unread: Promise.resolve(0),
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(join(here, "page.tsx"), "utf8");
const formSrc = readFileSync(join(here, "../../account/account-profile-form.tsx"), "utf8");
const companyFormSrc = readFileSync(
  join(here, "../../account/company-profile-form.tsx"),
  "utf8",
);
const actionSrc = readFileSync(join(here, "../../account/actions.ts"), "utf8");
const headerSrc = readFileSync(
  join(here, "../../../../components/chrome/settings-header-back.tsx"),
  "utf8",
);
const railSrc = readFileSync(
  join(here, "../../../../components/chrome/settings-rail.tsx"),
  "utf8",
);

describe("SettingsProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signedAvatarUrl).mockResolvedValue(null);
    stubMemberCan(true);
  });

  it("renders Profile then Company on the same page — no Agreements block and no second 220 column", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null) as never);
    const html = renderToStaticMarkup(await SettingsProfilePage());
    expect(html).toContain('data-settings-section="profile"');
    expect(html).toContain('data-settings-section="company"');
    expect(html).toContain('data-settings-page=""');
    expect(html).toContain(SETTINGS.profile);
    expect(html).toContain(SETTINGS.company);
    expect(html).not.toContain('data-settings-section="agreements"');
    expect(html).not.toContain(SETTINGS.agreementsEmpty);
    expect(html).not.toContain("User Profile");
    expect(html).not.toContain("Company Profile");
    expect(html).not.toContain("data-settings-local-nav");
    expect(html).not.toContain("data-settings-rail");
    expect(html).not.toContain("md:w-[220px]");
    expect(pageSrc).not.toContain("SettingsLocalNav");
    expect(pageSrc).not.toContain("SettingsRail");
    expect(pageSrc).not.toContain("md:w-[220px]");
    expect(pageSrc).not.toContain("md:flex-row");
    expect(pageSrc).not.toContain("HouseEmpty");
    expect(pageSrc).not.toContain("CardHeader");
    expect(pageSrc).not.toContain("PageHeader");
  });

  it("stacks the existing company block under the user card", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null) as never);
    const html = renderToStaticMarkup(await SettingsProfilePage());
    const profile = html.indexOf('data-settings-section="profile"');
    const company = html.indexOf('data-settings-section="company"');
    const userForm = html.indexOf("data-account-profile-form");
    const companyForm = html.indexOf("data-company-profile-form");
    expect(profile).toBeGreaterThan(-1);
    expect(company).toBeGreaterThan(profile);
    expect(userForm).toBeGreaterThan(profile);
    expect(userForm).toBeLessThan(company);
    expect(companyForm).toBeGreaterThan(company);
    expect(html).toContain(COMPANY_PROFILE.nameLabel);
    expect(html).toContain("Acme");
    expect(html).toContain('id="company-name"');
    expect(html).toContain(COMPANY_PROFILE.save);
    expect(pageSrc).toContain("CompanyProfileForm");
    expect(pageSrc).toContain("member_can");
    expect(companyFormSrc).toContain("saveCompanyName");
  });

  it("keeps Profile on the existing name / gated email / empty 48 photo path", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null) as never);
    const html = renderToStaticMarkup(await SettingsProfilePage());
    expect(html).toContain(ACCOUNT_PROFILE.nameLabel);
    expect(html).toContain(ACCOUNT_PROFILE.emailLabel);
    expect(html).toContain("ada@example.com");
    expect(html).toContain(ACCOUNT_PROFILE.emailHint);
    expect(html).toContain("Sign-in email. It cannot be changed here.");
    expect(html).not.toContain("Used to sign in.");
    expect(html).toContain('id="account-name"');
    expect(html).toContain('id="account-email"');
    expect(html).toContain(ACCOUNT_FIELD_CLASS);
    expect(html).toContain("readOnly");
    expect(html).toContain(ACCOUNT_PROFILE.uploadPhoto);
    expect(html).toContain(TEXT_ACTION_CLASS);
    expect(html).toContain(ACCOUNT_PHOTO_CIRCLE_CLASS);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Jane Doe");
    expect(html).not.toContain("Name and email on this account.");
  });

  it("fills a real display name when the session already has one", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx("Ada Lovelace") as never);
    const html = renderToStaticMarkup(await SettingsProfilePage());
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
  });

  it("does not invent a name from the email local-part", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null, "jane.doe@studio.com") as never);
    const html = renderToStaticMarkup(await SettingsProfilePage());
    expect(html).toContain("jane.doe@studio.com");
    expect(html).not.toContain("Jane Doe");
    expect(html).not.toContain('value="jane.doe"');
  });

  it("does not invent Phone / Job on the user card, or extra company columns", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null) as never);
    const html = renderToStaticMarkup(await SettingsProfilePage());
    for (const absent of SETTINGS_ABSENT) {
      expect(html).not.toContain(absent);
    }
    expect(html).not.toContain("Upload logo");
    expect(html).not.toContain("mailing address");
    expect(html).not.toContain("LinkedIn");
    expect(html).not.toContain("Website");
    expect(companyFormSrc).not.toContain("uploadCompanyLogo");
    expect(companyFormSrc).not.toContain("linkedin");
    expect(actionSrc).not.toContain("uploadCompanyLogo");
  });

  it("does not put Company on the rail or the 623:785 header", () => {
    expect(SETTINGS_LOCAL_NAV.map((item) => item.label)).not.toContain("Company");
    expect(SETTINGS_LOCAL_NAV.map((item) => item.kind)).not.toContain("company");
    expect(railSrc).not.toContain("Company");
    expect(headerSrc).not.toContain("Company");
    expect(headerSrc).toContain("623:785");
    expect(pageSrc).not.toContain("SettingsHeaderBack");
  });

  it("sends an unauthenticated visitor to login", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    await expect(SettingsProfilePage()).rejects.toThrow("REDIRECT:/login");
  });

  it("omits the company block when there is no active org", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null, "ada@example.com", false) as never);
    const html = renderToStaticMarkup(await SettingsProfilePage());
    expect(html).toContain('data-settings-section="profile"');
    expect(html).not.toContain('data-settings-section="company"');
    expect(html).not.toContain("data-company-profile-form");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("keeps photo persist on the existing avatar action and 16px inputs", () => {
    expect(pageSrc).toContain("AccountProfileForm");
    expect(pageSrc).toContain("signedAvatarUrl");
    expect(pageSrc).not.toContain("subtitle");
    expect(pageSrc).not.toContain("S3_AVATARS_BUCKET");
    expect(formSrc).toContain("saveAccountName");
    expect(formSrc).toContain("uploadAccountPhoto");
    expect(formSrc).toContain("ACCOUNT_FIELD_CLASS");
    expect(formSrc).toContain("TEXT_ACTION_CLASS");
    expect(actionSrc).toContain("putAvatarObject");
    expect(actionSrc).toContain('revalidatePath("/settings")');
    expect(actionSrc).toContain('revalidatePath("/settings/profile")');
    expect(actionSrc).not.toContain("S3_BUCKET");
    expect(pageSrc).not.toContain("Adam Carpenter");
    expect(pageSrc).not.toContain("admin@ccbfg.com");
  });

  it("renders a signed photo URL when one exists — never an invented face", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx("Ada Lovelace") as never);
    vi.mocked(signedAvatarUrl).mockResolvedValue("https://s3.example/signed-avatar");
    const html = renderToStaticMarkup(await SettingsProfilePage());
    expect(html).toContain("https://s3.example/signed-avatar");
    expect(html).toContain(ACCOUNT_PROFILE.photoAlt);
    expect(html).toContain("Ada Lovelace");
  });

  it("is read-only for company when member_can manage_settings is false", async () => {
    const rpc = stubMemberCan(false);
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null) as never);
    const html = renderToStaticMarkup(await SettingsProfilePage());
    expect(rpc).toHaveBeenCalledWith("member_can", {
      p_uid: "u1",
      p_org: "org-1",
      p_capability: "manage_settings",
    });
    expect(html).toContain("Acme");
    expect(html).toContain(COMPANY_PROFILE.forbidden);
    const companyHtml = html.slice(html.indexOf("data-company-profile-form"));
    expect(companyHtml).not.toContain(`>${COMPANY_PROFILE.save}<`);
  });
});
