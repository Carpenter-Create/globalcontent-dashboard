import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { revalidatePath } from "next/cache";

import { ACCOUNT_PROFILE, COMPANY_PROFILE } from "@/lib/account-profile";
import { saveAccountName, saveCompanyName } from "./actions";

const USER = { id: "u1", email: "ada@example.com", name: "Ada" };

function ctx({
  role = "account_owner",
  isGcStaff = false,
  hasOrg = true,
}: {
  role?: string;
  isGcStaff?: boolean;
  hasOrg?: boolean;
} = {}) {
  const org = hasOrg ? { id: "org-1", name: "Acme", status: "active" } : null;
  return {
    user: USER,
    rows: org ? [{ role, organizations: org }] : [],
    orgs: org ? [{ id: org.id, name: org.name }] : [],
    activeOrg: org,
    activeRole: org ? role : null,
    canOperate: role === "account_owner" || role === "delivery_ops",
    isGcStaff,
    unread: Promise.resolve(0),
  };
}

function authClient(updateUser = vi.fn(async () => ({ data: { user: USER }, error: null }))) {
  vi.mocked(createClient).mockResolvedValue({ auth: { updateUser } } as never);
  return { updateUser };
}

function orgClient({
  error = null,
  row = { id: "org-1" },
}: {
  error?: { message: string } | null;
  row?: { id: string } | null;
} = {}) {
  const maybeSingle = vi.fn(async () => ({ data: error ? null : row, error }));
  const select = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => {
    if (table !== "organizations") throw new Error(`unexpected from(${table})`);
    return { update };
  });
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { from, update, eq };
}

describe("saveAccountName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
  });

  it("writes trimmed display_name and does not touch email", async () => {
    const { updateUser } = authClient();
    await expect(saveAccountName("  Ada Lovelace  ")).resolves.toEqual({});
    expect(updateUser).toHaveBeenCalledWith({ data: { display_name: "Ada Lovelace" } });
    expect(updateUser).toHaveBeenCalledTimes(1);
    const payload = updateUser.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("email");
    expect(revalidatePath).toHaveBeenCalledWith("/account");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("allows an empty name so Identity stays blank", async () => {
    const { updateUser } = authClient();
    await expect(saveAccountName("   ")).resolves.toEqual({});
    expect(updateUser).toHaveBeenCalledWith({ data: { display_name: "" } });
  });

  it("does not write when there is no session", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    const { updateUser } = authClient();
    await expect(saveAccountName("Ada")).resolves.toEqual({ error: ACCOUNT_PROFILE.signedOut });
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("saveCompanyName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
  });

  it("updates organizations.name on the active org only", async () => {
    const { update, eq } = orgClient();
    await expect(saveCompanyName("  Northlight  ")).resolves.toEqual({});
    expect(update).toHaveBeenCalledWith({ name: "Northlight" });
    expect(eq).toHaveBeenCalledWith("id", "org-1");
    expect(revalidatePath).toHaveBeenCalledWith("/account/company");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("rejects an empty company name", async () => {
    const { update } = orgClient();
    await expect(saveCompanyName("  ")).resolves.toEqual({ error: COMPANY_PROFILE.nameRequired });
    expect(update).not.toHaveBeenCalled();
  });

  it("blocks delivery_ops before touching the row", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ role: "delivery_ops" }) as never);
    const { update } = orgClient();
    await expect(saveCompanyName("Northlight")).resolves.toEqual({
      error: COMPANY_PROFILE.forbidden,
    });
    expect(update).not.toHaveBeenCalled();
  });
});
