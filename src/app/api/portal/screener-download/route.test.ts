import { beforeEach, describe, expect, it, vi } from "vitest";

// Dedicated-ness comes from portal_resolve_screener.asset_kind (same snapshot as the key).
// A resolved master must never be signed for screener download (TOCTOU / Option D).
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

const RAW_TOKEN = "raw-session-token";

beforeEach(() => {
  vi.clearAllMocks();
});
const MASTER_ROW = {
  storage_key: "orgs/o1/titles/t1/master/x/file.mov",
  link_id: "link-1",
  session_id: "session-1",
  title_id: "title-1",
  asset_kind: "master",
};
const SCREENER_ROW = {
  storage_key: "orgs/o1/titles/t1/screener/x/file.mov",
  link_id: "link-1",
  session_id: "session-1",
  title_id: "title-1",
  asset_kind: "screener",
};

function mockCookie() {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === PORTAL.sessionCookie ? { value: RAW_TOKEN } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

type Handler = (filters: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

function fakeTable(handler: Handler) {
  const filters: Record<string, unknown> = {};
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit"]) builder[m] = vi.fn(() => builder);
  builder.eq = vi.fn((col: string, val: unknown) => {
    filters[col] = val;
    return builder;
  });
  builder.maybeSingle = vi.fn(async () => handler(filters));
  builder.insert = vi.fn(async () => handler(filters));
  return builder;
}

function fakeAdmin(opts: {
  rpcRow: unknown;
  tables?: Record<string, Handler>;
}) {
  const rpc = vi.fn(async () => ({ data: [opts.rpcRow], error: null }));
  const from = vi.fn((table: string) => {
    const handler = opts.tables?.[table];
    if (!handler) throw new Error(`fakeAdmin: unexpected table "${table}" queried`);
    return fakeTable(handler);
  });
  vi.mocked(createAdminClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof createAdminClient>);
  return { from, rpc };
}

describe("POST /api/portal/screener-download", () => {
  it("refuses the DOWNLOAD when the resolved asset is a master — never signs", async () => {
    mockCookie();
    const { from } = fakeAdmin({ rpcRow: MASTER_ROW, tables: {} });

    const res = await POST(new Request("http://test/", { method: "POST" }));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(403);
    expect(body.error).toBe(PORTAL_COPY.screenerDownloadUnavailableNotice);
    expect(assetViewUrl).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("still refuses on an unapproved title even when the resolved asset is a screener", async () => {
    mockCookie();
    fakeAdmin({
      rpcRow: SCREENER_ROW,
      tables: {
        titles: () => ({ data: { status: "in_review" }, error: null }),
        portal_links: () => ({ data: { recipient_name: "Tubi" }, error: null }),
      },
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));
    expect(res.status).toBe(403);
    expect(assetViewUrl).not.toHaveBeenCalled();
  });

  it("serves the download once the resolved asset is a screener on an approved title", async () => {
    mockCookie();
    vi.mocked(resolveOrRestore).mockResolvedValue({ status: "available" });
    vi.mocked(assetViewUrl).mockResolvedValue("https://signed.example/screener");
    fakeAdmin({
      rpcRow: SCREENER_ROW,
      tables: {
        titles: () => ({ data: { status: "in_delivery" }, error: null }),
        portal_links: () => ({ data: { recipient_name: "Tubi" }, error: null }),
        portal_access_events: () => ({ data: null, error: null }),
      },
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));
    const body = (await res.json()) as { url?: string };

    expect(res.status).toBe(200);
    expect(body.url).toBe("https://signed.example/screener");
  });
});
