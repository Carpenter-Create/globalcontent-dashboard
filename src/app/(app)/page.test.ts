import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrgContext } from "@/lib/supabase/context";
import DashboardPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

type Status = "registered" | "awaiting_payment" | "active";

function ctx({ isGcStaff, orgStatus }: { isGcStaff: boolean; orgStatus: Status | null }) {
  const org = orgStatus ? { id: "org-1", name: "Acme", status: orgStatus } : null;
  return {
    user: { id: "u1", email: "someone@example.com" },
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
 * #114 exempted the (app) layout, but this page still sent any session without a
 * client org to /onboarding. A gc_delivery_ops seat has none, so magic-link → /
 * walked them into the wizard anyway. Staff land on Queue; clients still onboard.
 */
describe("DashboardPage org gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends GC staff with no client org to /queue, not the wizard", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: true, orgStatus: null }) as never,
    );
    await expect(DashboardPage()).rejects.toThrow("REDIRECT:/queue");
  });

  it("still sends a non-GC user with no org to onboarding", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: false, orgStatus: null }) as never,
    );
    await expect(DashboardPage()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("sends an unauthenticated visitor to login", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    await expect(DashboardPage()).rejects.toThrow("REDIRECT:/login");
  });
});
