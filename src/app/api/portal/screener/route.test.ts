import { beforeEach, describe, expect, it, vi } from "vitest";

// Option D + TOCTOU close: portal stream authorizes on resolved asset_kind from
// portal_resolve_screener — never on a separately timed titles.screener_source read.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/s3", () => ({ resolveOrRestore: vi.fn() }));
vi.mock("@/lib/asset-url", () => ({ assetViewUrl: vi.fn() }));

import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOrRestore } from "@/lib/s3";
import { assetViewUrl } from "@/lib/asset-url";
import { PORTAL, PORTAL_COPY } from "@/lib/portal";
import { POST } from "./route";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAW_TOKEN = "raw-session-token";

beforeEach(() => {
  vi.clearAllMocks();
});

function mockCookie() {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === PORTAL.sessionCookie ? { value: RAW_TOKEN } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

function fakeAdmin(rpcRow: unknown) {
  const rpc = vi.fn(async () => ({ data: [rpcRow], error: null }));
  const from = vi.fn((table: string) => {
    throw new Error(`fakeAdmin: unexpected table "${table}" — route must not re-read title/source for the gate`);
  });
  vi.mocked(createAdminClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof createAdminClient>);
  return { from, rpc };
}

const MASTER_ROW = {
  storage_key: "orgs/o1/titles/t1/master/x/file.mov",
  link_id: "link-1",
  session_id: "session-1",
  title_id: "title-1",
  asset_kind: "master",
};

const SCREENER_ROW = {
  storage_key: "orgs/o1/titles/t1/screener/x/file_screener.mp4",
  link_id: "link-1",
  session_id: "session-1",
  title_id: "title-1",
  asset_kind: "screener",
};

describe("POST /api/portal/screener", () => {
  it("refuses when the resolved asset is a master (named or unnamed — same rule)", async () => {
    mockCookie();
    fakeAdmin(MASTER_ROW);

    const res = await POST(new Request("http://test/", { method: "POST" }));
    const body = (await res.json()) as { error?: string; url?: string };

    expect(res.status).toBe(403);
    expect(body.error).toBe(PORTAL_COPY.screenerStreamUnavailableNotice);
    expect(body.url).toBeUndefined();
    expect(assetViewUrl).not.toHaveBeenCalled();
    expect(resolveOrRestore).not.toHaveBeenCalled();
  });

  it("streams when the resolved asset is a dedicated screener", async () => {
    mockCookie();
    vi.mocked(resolveOrRestore).mockResolvedValue({ status: "available" });
    vi.mocked(assetViewUrl).mockResolvedValue("https://signed.example/screener");
    fakeAdmin(SCREENER_ROW);

    const res = await POST(new Request("http://test/", { method: "POST" }));
    const body = (await res.json()) as { url?: string };

    expect(res.status).toBe(200);
    expect(body.url).toBe("https://signed.example/screener");
    expect(assetViewUrl).toHaveBeenCalledWith(SCREENER_ROW.storage_key, PORTAL.screenerStreamTtlSeconds);
  });

  // TOCTOU regression: RPC already returned MASTER; a concurrent flip would make a later
  // titles.screener_source read say "dedicated". Route must still refuse and must not sign.
  it("refuses a resolved MASTER key even if a later title read would claim dedicated (TOCTOU)", async () => {
    mockCookie();
    // If the route incorrectly re-reads titles and treats dedicated as sufficient while
    // keeping the master key, this would be the failing shape. Our fakeAdmin throws on any
    // from() — and even if it did not, asset_kind master must 403 before signing.
    const { from } = fakeAdmin(MASTER_ROW);

    const res = await POST(new Request("http://test/", { method: "POST" }));

    expect(res.status).toBe(403);
    expect(assetViewUrl).not.toHaveBeenCalled();
    expect(resolveOrRestore).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("fails closed when asset_kind is missing from the RPC row", async () => {
    mockCookie();
    fakeAdmin({
      storage_key: SCREENER_ROW.storage_key,
      link_id: SCREENER_ROW.link_id,
      session_id: SCREENER_ROW.session_id,
      title_id: SCREENER_ROW.title_id,
      // asset_kind omitted — pre-migration / inconsistent shape
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));
    expect(res.status).toBe(403);
    expect(assetViewUrl).not.toHaveBeenCalled();
  });

  it("fails closed when asset_kind is an unexpected value", async () => {
    mockCookie();
    fakeAdmin({ ...SCREENER_ROW, asset_kind: "trailer" });

    const res = await POST(new Request("http://test/", { method: "POST" }));
    expect(res.status).toBe(403);
    expect(assetViewUrl).not.toHaveBeenCalled();
  });

  it("source pin: must authorize on resolved asset_kind, not titles.screener_source re-read", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/portal/screener/route.ts"), "utf8");
    expect(src).toContain("isDedicatedScreenerAsset");
    expect(src).toContain("asPortalResolvedScreener");
    // Runtime query/branch pins (comments may mention the old column name).
    expect(src).not.toMatch(/isBuyerLink/);
    expect(src).not.toMatch(/from\(\s*["']titles["']\s*\)/);
    expect(src).not.toMatch(/["']screener_source["']/);
  });
});
