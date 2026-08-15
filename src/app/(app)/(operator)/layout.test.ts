import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import OperatorLayout from "./layout";

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
 * /queue and /gc/clients stay behind the (operator) gc_staff gate. Dual-mode `/`
 * must not weaken that boundary — a client hitting those URLs is still bounced.
 */
describe("OperatorLayout gc_staff gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue(USER as never);
  });

  it("renders operator surfaces for a gc_staff row scoped to the signed-in user", async () => {
    const { from, eq } = stubClient({ user_id: USER.id });
    await expect(OperatorLayout({ children: "queue" })).resolves.toBeTruthy();
    expect(from).toHaveBeenCalledWith("gc_staff");
    expect(eq).toHaveBeenCalledWith("user_id", USER.id);
  });

  it("still bounces a non-staff user to /", async () => {
    stubClient(null);
    await expect(OperatorLayout({ children: "queue" })).rejects.toThrow("REDIRECT:/");
  });

  it("sends an unauthenticated visitor to login without querying", async () => {
    const { from } = stubClient(null);
    vi.mocked(getAuthUser).mockResolvedValue(null as never);
    await expect(OperatorLayout({ children: "queue" })).rejects.toThrow("REDIRECT:/login");
    expect(from).not.toHaveBeenCalled();
  });
});
