import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrgContext } from "@/lib/supabase/context";
import AppLayout from "./layout";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/components/chrome/app-shell", () => ({ AppShell: () => null }));

type Status = "registered" | "awaiting_payment" | "active";

function ctx({ isGcStaff, orgStatus }: { isGcStaff: boolean; orgStatus: Status | null }) {
  const org = orgStatus ? { id: "org-1", name: "Acme", status: orgStatus } : null;
  return {
    user: { id: "u1", email: "someone@example.com", name: null },
    rows: org ? [{ role: "account_owner", organizations: org }] : [],
    orgs: org ? [{ id: org.id, name: org.name }] : [],
    activeOrg: org,
    activeRole: org ? "account_owner" : null,
    canOperate: !!org,
    isGcStaff,
    unread: Promise.resolve(0),
  };
}

/**
 * Both onboarding redirects must exempt GC staff. The no-org branch always did; the
 * mid-onboarding branch did not, so a GC operator holding a non-active client org was
 * bounced to a wizard that has no exit for staff — a loop, not a detour.
 */
describe("AppLayout onboarding gates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not bounce GC staff whose client org is mid-onboarding", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: true, orgStatus: "registered" }) as never,
    );
    await expect(AppLayout({ children: "page" })).resolves.toBeTruthy();
  });

  it("still bounces a non-GC client whose org is mid-onboarding", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: false, orgStatus: "registered" }) as never,
    );
    await expect(AppLayout({ children: "page" })).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("renders the shell for GC staff with no client org at all", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: true, orgStatus: null }) as never,
    );
    await expect(AppLayout({ children: "page" })).resolves.toBeTruthy();
  });

  it("still bounces a non-GC user with no org", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: false, orgStatus: null }) as never,
    );
    await expect(AppLayout({ children: "page" })).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("renders for an ordinary client whose org is active", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: false, orgStatus: "active" }) as never,
    );
    await expect(AppLayout({ children: "page" })).resolves.toBeTruthy();
  });

  it("sends an unauthenticated visitor to login", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    await expect(AppLayout({ children: "page" })).rejects.toThrow("REDIRECT:/login");
  });
});
