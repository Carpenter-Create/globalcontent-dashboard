import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import OnboardingLayout from "./layout";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ getAuthUser: vi.fn() }));

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "ops@globalcontent.co" };

/** Minimal stand-in for the one chain this layout runs: from().select().eq().maybeSingle(). */
function stubClient(staffRow: { user_id: string } | null) {
  const eq = vi.fn();
  const chain = {
    select: vi.fn(() => chain),
    eq: (...args: unknown[]) => {
      eq(...args);
      return chain;
    },
    maybeSingle: vi.fn(async () => ({ data: staffRow, error: null })),
  };
  const from = vi.fn(() => chain);
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { from, eq };
}

/**
 * The wizard sits OUTSIDE the (app) route group, so it never inherits that group's
 * GC-staff exemption. Provisioning a gc_delivery_ops account on 2026-08-15 walked it
 * straight into "Name your organization" — a client-only flow offering to create an org
 * a GC operator must not hold. These tests pin the gate that closes that path.
 */
describe("OnboardingLayout GC-staff gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue(USER as never);
  });

  it("sends a GC staff member to the dashboard instead of the wizard", async () => {
    stubClient({ user_id: USER.id });
    await expect(OnboardingLayout({ children: "step" })).rejects.toThrow("REDIRECT:/");
  });

  it("renders the wizard for a client with no staff row", async () => {
    stubClient(null);
    await expect(OnboardingLayout({ children: "step" })).resolves.toBeTruthy();
  });

  it("checks gc_staff scoped to the signed-in user", async () => {
    const { from, eq } = stubClient(null);
    await OnboardingLayout({ children: "step" });
    expect(from).toHaveBeenCalledWith("gc_staff");
    expect(eq).toHaveBeenCalledWith("user_id", USER.id);
  });

  it("sends an unauthenticated visitor to login without querying", async () => {
    const { from } = stubClient(null);
    vi.mocked(getAuthUser).mockResolvedValue(null as never);
    await expect(OnboardingLayout({ children: "step" })).rejects.toThrow("REDIRECT:/login");
    expect(from).not.toHaveBeenCalled();
  });
});
