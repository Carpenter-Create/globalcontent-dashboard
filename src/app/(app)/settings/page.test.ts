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
import { HOUSE_EMPTY_CLASS } from "@/lib/house-sheet";
import { TEXT_ACTION_CLASS } from "@/lib/house-sheet";
import { SETTINGS, SETTINGS_ABSENT, SETTINGS_LOCAL_NAV } from "@/lib/settings";
import SettingsPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  useRouter: () => ({ refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings",
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/s3-avatars", () => ({ signedAvatarUrl: vi.fn() }));
vi.mock("../account/actions", () => ({ saveAccountName: vi.fn(), uploadAccountPhoto: vi.fn() }));

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
const navSrc = readFileSync(join(here, "settings-local-nav.tsx"), "utf8");
const formSrc = readFileSync(join(here, "../account/account-profile-form.tsx"), "utf8");
const actionSrc = readFileSync(join(here, "../account/actions.ts"), "utf8");

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signedAvatarUrl).mockResolvedValue(null);
  });

  it("renders #profile and #agreements with local nav Dashboard / Profile / Agreements", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null) as never);
    const html = renderToStaticMarkup(await SettingsPage());
    expect(html).toContain('id="profile"');
    expect(html).toContain('id="agreements"');
    expect(html).toContain('data-settings-section="profile"');
    expect(html).toContain('data-settings-section="agreements"');
    expect(html).toContain('data-settings-local-nav=""');
    for (const item of SETTINGS_LOCAL_NAV) {
      expect(html).toContain(`href="${item.href}"`);
      expect(html).toContain(item.label);
    }
    expect(html).toContain(SETTINGS.profile);
    expect(html).toContain(SETTINGS.agreements);
    expect(html).not.toContain("User Profile");
  });

  it("keeps #profile on the existing name / gated email / empty 48 photo path", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null) as never);
    const html = renderToStaticMarkup(await SettingsPage());
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
    const html = renderToStaticMarkup(await SettingsPage());
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
  });

  it("does not invent a name from the email local-part", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null, "jane.doe@studio.com") as never);
    const html = renderToStaticMarkup(await SettingsPage());
    expect(html).toContain("jane.doe@studio.com");
    expect(html).not.toContain("Jane Doe");
    expect(html).not.toContain('value="jane.doe"');
  });

  it("houses #agreements empty and does not invent Phone / Job / Company", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null) as never);
    const html = renderToStaticMarkup(await SettingsPage());
    expect(html).toContain(SETTINGS.agreementsEmpty);
    expect(html).toContain(HOUSE_EMPTY_CLASS);
    expect(html).toContain("data-house-empty");
    expect(html).not.toContain("No agreements accepted yet.");
    expect(html).not.toContain("Download");
    expect(html).not.toContain("View agreement text");
    expect(html).not.toContain("contract_assents");
    for (const absent of SETTINGS_ABSENT) {
      expect(html).not.toContain(absent);
    }
  });

  it("sends an unauthenticated visitor to login", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    await expect(SettingsPage()).rejects.toThrow("REDIRECT:/login");
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
    expect(actionSrc).not.toContain("S3_BUCKET");
    expect(navSrc).toContain("SETTINGS_LOCAL_NAV");
    expect(navSrc).toContain("ChevronLeft");
    expect(`${pageSrc}${navSrc}`).not.toContain("Adam Carpenter");
    expect(`${pageSrc}${navSrc}`).not.toContain("admin@ccbfg.com");
  });

  it("renders a signed photo URL when one exists — never an invented face", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx("Ada Lovelace") as never);
    vi.mocked(signedAvatarUrl).mockResolvedValue("https://s3.example/signed-avatar");
    const html = renderToStaticMarkup(await SettingsPage());
    expect(html).toContain("https://s3.example/signed-avatar");
    expect(html).toContain(ACCOUNT_PROFILE.photoAlt);
    expect(html).toContain("Ada Lovelace");
  });
});
