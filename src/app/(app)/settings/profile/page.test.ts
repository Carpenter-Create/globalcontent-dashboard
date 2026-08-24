import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrgContext } from "@/lib/supabase/context";
import { signedAvatarUrl } from "@/lib/s3-avatars";
import {
  ACCOUNT_FIELD_CLASS,
  ACCOUNT_PROFILE,
  ACCOUNT_PHOTO_CIRCLE_CLASS,
} from "@/lib/account-profile";
import { TEXT_ACTION_CLASS } from "@/lib/house-sheet";
import { SETTINGS, SETTINGS_ABSENT } from "@/lib/settings";
import SettingsProfilePage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  useRouter: () => ({ refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings/profile",
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/s3-avatars", () => ({ signedAvatarUrl: vi.fn() }));
vi.mock("../../account/actions", () => ({ saveAccountName: vi.fn(), uploadAccountPhoto: vi.fn() }));

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

const here = dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(join(here, "page.tsx"), "utf8");
const formSrc = readFileSync(join(here, "../../account/account-profile-form.tsx"), "utf8");
const actionSrc = readFileSync(join(here, "../../account/actions.ts"), "utf8");

describe("SettingsProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signedAvatarUrl).mockResolvedValue(null);
  });

  it("renders Profile only — no Agreements block and no second 220 column", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null) as never);
    const html = renderToStaticMarkup(await SettingsProfilePage());
    expect(html).toContain('data-settings-section="profile"');
    expect(html).toContain('data-settings-page=""');
    expect(html).toContain(SETTINGS.profile);
    expect(html).not.toContain('data-settings-section="agreements"');
    expect(html).not.toContain(SETTINGS.agreementsEmpty);
    expect(html).not.toContain("User Profile");
    expect(html).not.toContain("data-settings-local-nav");
    expect(html).not.toContain("data-settings-rail");
    expect(html).not.toContain("md:w-[220px]");
    expect(pageSrc).not.toContain("SettingsLocalNav");
    expect(pageSrc).not.toContain("SettingsRail");
    expect(pageSrc).not.toContain("md:w-[220px]");
    expect(pageSrc).not.toContain("md:flex-row");
    expect(pageSrc).not.toContain("HouseEmpty");
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

  it("does not invent Phone / Job / Company on Profile", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null) as never);
    const html = renderToStaticMarkup(await SettingsProfilePage());
    for (const absent of SETTINGS_ABSENT) {
      expect(html).not.toContain(absent);
    }
  });

  it("sends an unauthenticated visitor to login", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    await expect(SettingsProfilePage()).rejects.toThrow("REDIRECT:/login");
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
});
