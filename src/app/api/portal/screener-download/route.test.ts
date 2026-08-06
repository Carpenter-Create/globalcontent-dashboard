import { describe, expect, it, vi } from "vitest";

// Fix round 1, task 9, item 1 (CRITICAL): on the default screener_source = 'master', the
// asset portal_resolve_screener resolves IS the master, byte-for-byte — so a download here
// with no further gate would hand the unwatermarked master to any prospect holding a
// screener_view link, bypassing the licence gate the master route enforces entirely. These
// tests pin the fix: the route refuses the download (never the watch) on a non-dedicated
// source, and still serves it once the source is a real dedicated screener asset.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/s3", () => ({ resolveOrRestore: vi.fn() }));
vi.mock("@/lib/asset-url", () => ({ assetViewUrl: vi.fn() }));

import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOrRestore } from "@/lib/s3";
import { assetViewUrl } from "@/lib/asset-url";
import { PORTAL } from "@/lib/portal";
import { POST } from "./route";

const RAW_TOKEN = "raw-session-token";
// Fix round 3, item 7: this fixture backs the one green (200) path in the suite below, which
// asserts `screener_source: "dedicated"` — a `/master/`-shaped key there was incoherent (the
// one passing case claimed to be "dedicated source, master file"). A dedicated screener's
// storage key lives under a `screener/` prefix, same convention as assetKey() (lib/assets.ts).
const RESOLVED_ROW = { storage_key: "orgs/o1/titles/t1/screener/x/file.mov", link_id: "link-1", session_id: "session-1", title_id: "title-1" };

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

function fakeAdmin(opts: { rpcResult?: { data: unknown; error: { message: string } | null }; tables: Record<string, Handler> }) {
  const rpc = vi.fn(async () => opts.rpcResult ?? { data: [RESOLVED_ROW], error: null });
  const from = vi.fn((table: string) => {
    const handler = opts.tables[table];
    if (!handler) throw new Error(`fakeAdmin: unexpected table "${table}" queried`);
    return fakeTable(handler);
  });
  vi.mocked(createAdminClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof createAdminClient>);
  return { from, rpc };
}

describe("POST /api/portal/screener-download", () => {
  it("refuses the DOWNLOAD when screener_source is not dedicated, even though the title is approved", async () => {
    mockCookie();
    fakeAdmin({
      tables: {
        titles: () => ({ data: { status: "in_delivery", screener_source: "master" }, error: null }),
      },
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(403);
    // Distinct from the generic "Not authorized" — proves this is the new, honest refusal
    // path and not just a fallthrough to the old one.
    expect(body.error).toMatch(/available to watch but not to download/i);
  });

  it("still refuses on an unapproved title even when the source IS dedicated", async () => {
    mockCookie();
    fakeAdmin({
      tables: {
        titles: () => ({ data: { status: "in_review", screener_source: "dedicated" }, error: null }),
      },
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));
    expect(res.status).toBe(403);
  });

  it("serves the download once the screener is a real dedicated asset on an approved title", async () => {
    mockCookie();
    vi.mocked(resolveOrRestore).mockResolvedValue({ status: "available" });
    vi.mocked(assetViewUrl).mockResolvedValue("https://signed.example/screener");
    fakeAdmin({
      tables: {
        titles: () => ({ data: { status: "in_delivery", screener_source: "dedicated" }, error: null }),
        portal_access_events: () => ({ data: null, error: null }),
      },
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));
    const body = (await res.json()) as { url?: string };

    expect(res.status).toBe(200);
    expect(body.url).toBe("https://signed.example/screener");
  });
});
