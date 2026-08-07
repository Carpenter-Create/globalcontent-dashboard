import { describe, expect, it, vi } from "vitest";

// Final blockers, item 1 (CRITICAL) + item 5: this is the enforcement point for the branch's
// headline fix — a buyer link (named recipient) must never stream a master-sourced "screener",
// since on the 'master' default that IS the master byte-for-byte (screenerKindFor's comment,
// lib/assets.ts), and a <video> stream is a directly-copyable signed URL, not a copy-protected
// format. This route had no test at all before this file; it is the ONLY portal route that
// didn't. Also pins the fail-closed fix: an unreadable portal_links row must refuse, not skip
// the gate — the original bug streamed the master when that read failed.
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
const RESOLVED_ROW = {
  storage_key: "orgs/o1/titles/t1/master/x/file.mov",
  link_id: "link-1",
  session_id: "session-1",
  title_id: "title-1",
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
  rpcResult?: { data: unknown; error: { message: string } | null };
  tables: Record<string, Handler>;
}) {
  const rpc = vi.fn(async () => opts.rpcResult ?? { data: [RESOLVED_ROW], error: null });
  const from = vi.fn((table: string) => {
    const handler = opts.tables[table];
    if (!handler) throw new Error(`fakeAdmin: unexpected table "${table}" queried`);
    return fakeTable(handler);
  });
  vi.mocked(createAdminClient).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof createAdminClient>);
  return { from, rpc };
}

describe("POST /api/portal/screener", () => {
  it("refuses to stream a master-sourced screener over a buyer link (named recipient)", async () => {
    mockCookie();
    fakeAdmin({
      tables: {
        portal_links: () => ({ data: { recipient_name: "Tubi" }, error: null }),
        titles: () => ({ data: { screener_source: "master" }, error: null }),
      },
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(403);
    expect(body.error).toBe(PORTAL_COPY.screenerStreamUnavailableNotice);
  });

  it("streams a buyer link once the title has a real dedicated screener asset", async () => {
    mockCookie();
    vi.mocked(resolveOrRestore).mockResolvedValue({ status: "available" });
    vi.mocked(assetViewUrl).mockResolvedValue("https://signed.example/screener");
    fakeAdmin({
      tables: {
        portal_links: () => ({ data: { recipient_name: "Tubi" }, error: null }),
        titles: () => ({ data: { screener_source: "dedicated" }, error: null }),
      },
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));
    const body = (await res.json()) as { url?: string };

    expect(res.status).toBe(200);
    expect(body.url).toBe("https://signed.example/screener");
  });

  it("streams a master-sourced screener over GC's own unnamed operational link", async () => {
    mockCookie();
    vi.mocked(resolveOrRestore).mockResolvedValue({ status: "available" });
    vi.mocked(assetViewUrl).mockResolvedValue("https://signed.example/master");
    fakeAdmin({
      tables: {
        portal_links: () => ({ data: { recipient_name: null }, error: null }),
        titles: () => ({ data: { screener_source: "master" }, error: null }),
      },
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));
    const body = (await res.json()) as { url?: string };

    expect(res.status).toBe(200);
    expect(body.url).toBe("https://signed.example/master");
  });

  // Final blockers, item 1 (CRITICAL): the bug this pins. A transient read failure on
  // portal_links must never be treated as "not a buyer link" — that reading is what let the
  // gate skip and stream a buyer link's master. An unreadable row is now the CLOSED case:
  // treated as a buyer link, refused unless the title's screener is independently dedicated.
  it("refuses when the portal_links row cannot be read, even on a master-sourced title", async () => {
    mockCookie();
    fakeAdmin({
      tables: {
        portal_links: () => ({ data: null, error: { message: "read failed" } }),
        titles: () => ({ data: { screener_source: "master" }, error: null }),
      },
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(403);
    expect(body.error).toBe(PORTAL_COPY.screenerStreamUnavailableNotice);
  });
});
