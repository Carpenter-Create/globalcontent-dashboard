import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";

import { createOrg } from "./actions";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "jane@acmefilms.com" };

type Err = { message: string } | null;

function client({ rpcError = null, updateError = null }: { rpcError?: Err; updateError?: Err } = {}) {
  const rpc = vi.fn(async () => ({ data: rpcError ? null : "org-1", error: rpcError }));
  const updateUser = vi.fn(async () => ({ data: { user: USER }, error: updateError }));
  vi.mocked(createClient).mockResolvedValue({ rpc, auth: { updateUser } } as never);
  return { rpc, updateUser };
}

/**
 * Signup is magic-link only, so nothing is ever written to user_metadata and the
 * Supabase Auth → Users list shows a blank Display name. The org name from
 * onboarding step 2 is the only name we hold; createOrg mirrors it so the founder
 * can identify a row in the dashboard. Display only — never an authorization input.
 */
describe("createOrg display-name mirror", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue(USER as never);
  });

  it("mirrors the trimmed org name into user_metadata.display_name", async () => {
    const { updateUser } = client();
    await expect(createOrg("  Acme Films  ")).rejects.toThrow("REDIRECT:/onboarding/plan");
    expect(updateUser).toHaveBeenCalledWith({ data: { display_name: "Acme Films" } });
  });

  it("does not write metadata when the org RPC fails", async () => {
    const { updateUser } = client({ rpcError: { message: "Organization name is required" } });
    await expect(createOrg("")).resolves.toEqual({ error: "Organization name is required" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("completes signup even if the metadata write fails", async () => {
    const { updateUser } = client({ updateError: { message: "rate limited" } });
    // The org exists at this point — a cosmetic failure must not strand the wizard.
    await expect(createOrg("Northlight")).rejects.toThrow("REDIRECT:/onboarding/plan");
    expect(updateUser).toHaveBeenCalledOnce();
  });

  it("writes nothing when there is no session", async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null as never);
    const { rpc, updateUser } = client();
    await expect(createOrg("Acme Films")).resolves.toEqual({ error: "Not authenticated." });
    expect(rpc).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
});
