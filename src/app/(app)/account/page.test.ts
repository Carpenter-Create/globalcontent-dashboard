import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrgContext } from "@/lib/supabase/context";
import { signedAvatarUrl } from "@/lib/s3-avatars";
import { ACCOUNT_FIELD_CLASS, ACCOUNT_PROFILE, ACCOUNT_PHOTO_CIRCLE_CLASS } from "@/lib/account-profile";
import { TEXT_ACTION_CLASS } from "@/lib/house-sheet";
import AccountPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  useRouter: () => ({ refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/s3-avatars", () => ({ signedAvatarUrl: vi.fn() }));
vi.mock("./actions", () => ({ saveAccountName: vi.fn(), uploadAccountPhoto: vi.fn() }));

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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signedAvatarUrl).mockResolvedValue(null);
  });

  it("renders name and email from the session user — empty name stays empty", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null) as never);
    const html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain(ACCOUNT_PROFILE.title);
    expect(html).toContain(ACCOUNT_PROFILE.nameLabel);
    expect(html).toContain(ACCOUNT_PROFILE.emailLabel);
    expect(html).toContain("ada@example.com");
    expect(html).toContain(ACCOUNT_PROFILE.emailHint);
    expect(html).toContain('id="account-name"');
    expect(html).toContain('id="account-email"');
    expect(html).toContain(ACCOUNT_FIELD_CLASS);
    expect(html).toContain("readOnly");
    expect(html).not.toContain("Jane Doe");
    expect(html).not.toContain("ada</");
    expect(html).not.toContain("Name and email on this account.");
  });

  it("fills a real display name when the session already has one", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx("Ada Lovelace") as never);
    const html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("ada@example.com");
  });

  it("does not invent a name from the email local-part", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null, "jane.doe@studio.com") as never);
    const html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain("jane.doe@studio.com");
    expect(html).not.toContain("Jane Doe");
    expect(html).not.toContain('value="jane.doe"');
  });

  it("sends an unauthenticated visitor to login", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    await expect(AccountPage()).rejects.toThrow("REDIRECT:/login");
  });

  it("is the same /account page on desktop and mobile — not a sheet-only destination", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pageSrc = readFileSync(join(here, "page.tsx"), "utf8");
    const formSrc = readFileSync(join(here, "account-profile-form.tsx"), "utf8");
    const actionSrc = readFileSync(join(here, "actions.ts"), "utf8");
    expect(pageSrc).toContain("AccountProfileForm");
    expect(pageSrc).not.toContain("subtitle");
    expect(formSrc).toContain("saveAccountName");
    expect(formSrc).toContain("uploadAccountPhoto");
    expect(formSrc).toContain("ACCOUNT_FIELD_CLASS");
    expect(formSrc).toContain("TEXT_ACTION_CLASS");
    expect(formSrc).toContain(".blur(");
    expect(formSrc).not.toContain("Appearance");
    expect(actionSrc).toContain("updateUser");
    expect(actionSrc).toContain("display_name");
    expect(actionSrc).toContain("refreshSession");
    expect(actionSrc).toContain("putAvatarObject");
    expect(actionSrc).not.toContain("S3_BUCKET");
    expect(`${pageSrc}${formSrc}`).not.toMatch(/md:hidden|hidden md:|max-md:/);
    expect(pageSrc).not.toContain("/account/profile");
    expect(ACCOUNT_PROFILE.href).toBe("/account");
  });

  it("shows an empty 48 circle and Upload photo until a real photo exists", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx(null) as never);
    const html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain(ACCOUNT_PROFILE.uploadPhoto);
    expect(html).toContain(TEXT_ACTION_CLASS);
    expect(html).toContain(ACCOUNT_PHOTO_CIRCLE_CLASS);
    expect(html).toContain('data-account-photo=""');
    expect(html).not.toContain("<img");
    expect(html).not.toContain(ACCOUNT_PROFILE.photoAlt);
    expect(html).not.toMatch(/gravatar|placeholder photo|default avatar/i);
  });

  it("renders a signed photo URL when one exists — never an invented face", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx("Ada Lovelace") as never);
    vi.mocked(signedAvatarUrl).mockResolvedValue("https://s3.example/signed-avatar");
    const html = renderToStaticMarkup(await AccountPage());
    expect(html).toContain("https://s3.example/signed-avatar");
    expect(html).toContain(ACCOUNT_PROFILE.photoAlt);
    expect(html).toContain("Ada Lovelace");
  });
});
