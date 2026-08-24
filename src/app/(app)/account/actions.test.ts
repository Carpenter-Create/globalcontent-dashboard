import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/s3-avatars", () => ({ putAvatarObject: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { revalidatePath } from "next/cache";
import { putAvatarObject } from "@/lib/s3-avatars";

import { ACCOUNT_NAME_MAX, ACCOUNT_PROFILE, COMPANY_PROFILE } from "@/lib/account-profile";
import { AVATAR_MAX_BYTES } from "@/lib/account-avatar";
import { saveAccountName, saveCompanyName, uploadAccountPhoto } from "./actions";

const USER = { id: "u1", email: "ada@example.com", name: "Ada" };
const ORG_ID = "11111111-1111-4111-8111-111111111111";

function ctx({
  role = "account_owner",
  isGcStaff = false,
  hasOrg = true,
}: {
  role?: string;
  isGcStaff?: boolean;
  hasOrg?: boolean;
} = {}) {
  const org = hasOrg ? { id: ORG_ID, name: "Acme", status: "active" } : null;
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

function authClient({
  updateUser = vi.fn(async () => ({ data: { user: USER }, error: null })),
  refreshSession = vi.fn(async () => ({ data: { session: {} }, error: null })),
}: {
  updateUser?: ReturnType<typeof vi.fn>;
  refreshSession?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.mocked(createClient).mockResolvedValue({ auth: { updateUser, refreshSession } } as never);
  return { updateUser, refreshSession };
}

function orgClient({
  canManage = true,
  error = null,
  row = { id: ORG_ID },
}: {
  canManage?: boolean;
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
  const rpc = vi.fn(async (name: string, args: { p_capability?: string; p_org?: string }) => {
    if (name !== "member_can") throw new Error(`unexpected rpc(${name})`);
    expect(args.p_capability).toBe("manage_settings");
    return { data: canManage, error: null };
  });
  vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);
  return { from, update, eq, rpc };
}

describe("saveAccountName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
  });

  it("writes trimmed display_name, refreshes the JWT, and does not touch email", async () => {
    const { updateUser, refreshSession } = authClient();
    await expect(saveAccountName("  Ada Lovelace  ")).resolves.toEqual({});
    expect(updateUser).toHaveBeenCalledWith({ data: { display_name: "Ada Lovelace" } });
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(updateUser.mock.invocationCallOrder[0]).toBeLessThan(
      refreshSession.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(updateUser).not.toHaveBeenCalledWith(expect.objectContaining({ email: expect.anything() }));
    expect(revalidatePath).toHaveBeenCalledWith("/account");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("allows an empty name so Identity stays blank", async () => {
    const { updateUser, refreshSession } = authClient();
    await expect(saveAccountName("   ")).resolves.toEqual({});
    expect(updateUser).toHaveBeenCalledWith({ data: { display_name: "" } });
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-string or oversized name before Auth", async () => {
    const { updateUser } = authClient();
    await expect(saveAccountName(12)).resolves.toEqual({ error: ACCOUNT_PROFILE.invalidName });
    await expect(saveAccountName("x".repeat(ACCOUNT_NAME_MAX + 1))).resolves.toEqual({
      error: ACCOUNT_PROFILE.invalidName,
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("does not write when there is no session", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    const { updateUser, refreshSession } = authClient();
    await expect(saveAccountName("Ada")).resolves.toEqual({ error: ACCOUNT_PROFILE.signedOut });
    expect(updateUser).not.toHaveBeenCalled();
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("does not claim saved when the session cannot refresh after the write", async () => {
    const { updateUser, refreshSession } = authClient({
      refreshSession: vi.fn(async () => ({
        data: { session: null },
        error: { message: "refresh failed" },
      })),
    });
    await expect(saveAccountName("Ada Lovelace")).resolves.toEqual({ error: "refresh failed" });
    expect(updateUser).toHaveBeenCalledOnce();
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

function photoForm(file: File) {
  const body = new FormData();
  body.set("photo", file);
  return body;
}

describe("uploadAccountPhoto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(putAvatarObject).mockResolvedValue(undefined);
  });

  it("PUTs the session user's bytes and does not touch email", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "face.jpg", { type: "image/jpeg" });
    await expect(uploadAccountPhoto(photoForm(file))).resolves.toEqual({});
    expect(putAvatarObject).toHaveBeenCalledTimes(1);
    const [userId, body, type] = vi.mocked(putAvatarObject).mock.calls[0] ?? [];
    expect(userId).toBe(USER.id);
    expect(type).toBe("image/jpeg");
    expect(body).toBeInstanceOf(Uint8Array);
    expect(revalidatePath).toHaveBeenCalledWith("/account");
  });

  it("rejects a missing file, a gif, and an oversized file before S3", async () => {
    await expect(uploadAccountPhoto(new FormData())).resolves.toEqual({
      error: ACCOUNT_PROFILE.photoMissing,
    });
    const gif = new File([new Uint8Array([1])], "face.gif", { type: "image/gif" });
    await expect(uploadAccountPhoto(photoForm(gif))).resolves.toEqual({
      error: ACCOUNT_PROFILE.photoType,
    });
    const big = new File([new Uint8Array(AVATAR_MAX_BYTES + 1)], "face.jpg", {
      type: "image/jpeg",
    });
    await expect(uploadAccountPhoto(photoForm(big))).resolves.toEqual({
      error: ACCOUNT_PROFILE.photoTooLarge,
    });
    expect(putAvatarObject).not.toHaveBeenCalled();
  });

  it("does not write when there is no session", async () => {
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    const file = new File([new Uint8Array([1])], "face.jpg", { type: "image/jpeg" });
    await expect(uploadAccountPhoto(photoForm(file))).resolves.toEqual({
      error: ACCOUNT_PROFILE.signedOut,
    });
    expect(putAvatarObject).not.toHaveBeenCalled();
  });
});

describe("saveCompanyName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
  });

  it("updates organizations.name on the org the form rendered", async () => {
    const { update, eq, rpc } = orgClient();
    await expect(saveCompanyName({ orgId: ORG_ID, name: "  Northlight  " })).resolves.toEqual({});
    expect(rpc).toHaveBeenCalledWith("member_can", {
      p_uid: USER.id,
      p_org: ORG_ID,
      p_capability: "manage_settings",
    });
    expect(update).toHaveBeenCalledWith({ name: "Northlight" });
    expect(eq).toHaveBeenCalledWith("id", ORG_ID);
    expect(revalidatePath).toHaveBeenCalledWith("/account/company");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("does not follow a later active-org cookie when the form org is passed", async () => {
    const other = "22222222-2222-4222-8222-222222222222";
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ role: "account_owner" }) as never,
    );
    const { eq, rpc } = orgClient();
    await expect(saveCompanyName({ orgId: other, name: "Northlight" })).resolves.toEqual({});
    expect(rpc).toHaveBeenCalledWith("member_can", {
      p_uid: USER.id,
      p_org: other,
      p_capability: "manage_settings",
    });
    expect(eq).toHaveBeenCalledWith("id", other);
    expect(eq).not.toHaveBeenCalledWith("id", ORG_ID);
  });

  it("rejects an empty company name", async () => {
    const { update, rpc } = orgClient();
    await expect(saveCompanyName({ orgId: ORG_ID, name: "  " })).resolves.toEqual({
      error: COMPANY_PROFILE.nameRequired,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("blocks when member_can manage_settings is false — including GC staff without that capability", async () => {
    const { update, rpc } = orgClient({ canManage: false });
    await expect(saveCompanyName({ orgId: ORG_ID, name: "Northlight" })).resolves.toEqual({
      error: COMPANY_PROFILE.forbidden,
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });
});
