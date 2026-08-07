import { describe, expect, it, vi } from "vitest";

// This route is the highest-risk one in the buyer portal — it serves the master. These tests
// pin the three things holding it in that fix-round-1 review flagged as untested: the
// (title_id, vendor_id) SCOPING of the licence query, the null-vendor short-circuit (refused
// BEFORE any delivery query runs), and the fail-closed audit write. No test in this repo yet
// mocks a Next.js Route Handler's dependencies — `next/headers` and the admin client are
// mocked locally here, same "smallest mock that covers what's actually called" approach
// actions.test.ts already established for the Supabase server client.
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

const FAR_FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const RAW_TOKEN = "raw-session-token";

const VALID_SESSION = { id: "session-1", link_id: "link-1", expires_at: FAR_FUTURE, revoked_at: null };
const LINK_WITH_VENDOR = {
  id: "link-1",
  purpose: "screener_view",
  title_id: "title-1",
  vendor_id: "vendor-1",
  recipient_name: "Tubi",
  expires_at: FAR_FUTURE,
  revoked_at: null,
};

const WORLD_GRANT = {
  effective_to: null,
  window_start: null,
  window_end: null,
  territory_mode: "world",
  territories: [],
};

function mockCookie() {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === PORTAL.sessionCookie ? { value: RAW_TOKEN } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

type Handler = (filters: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

// A chainable stand-in for the admin client's query builder. Every `.eq(col, val)` is recorded
// into `filters` so a table's handler can see EXACTLY what the route scoped its query to —
// the point of these tests is proving that scoping happens, not just that a value comes back.
// `.maybeSingle()`, awaiting the builder directly (deliveries has no single-row call), and
// `.insert()` (portal_access_events) all resolve through the same handler.
function fakeTable(handler: Handler) {
  const filters: Record<string, unknown> = {};
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "in"]) builder[m] = vi.fn(() => builder);
  builder.eq = vi.fn((col: string, val: unknown) => {
    filters[col] = val;
    return builder;
  });
  builder.maybeSingle = vi.fn(async () => handler(filters));
  builder.insert = vi.fn(async () => handler(filters));
  builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(handler(filters)).then(resolve, reject);
  return builder;
}

function fakeAdmin(handlers: Record<string, Handler>) {
  const from = vi.fn((table: string) => {
    const handler = handlers[table];
    if (!handler) throw new Error(`fakeAdmin: unexpected table "${table}" queried`);
    return fakeTable(handler);
  });
  vi.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);
  return { from };
}

describe("POST /api/portal/master-download", () => {
  // Fix round 3, item 5: resolveBuyerLink collapses session-revoked, session-expired,
  // link-revoked and link-expired into one null return. Before this fix the route turned
  // that into a bare {"error":"Not authorized"} — which describeDownloadFailure/
  // downloadFailureMessage's 403 branch then surfaced to the buyer VERBATIM, instead of the
  // "contact your Global Content representative" copy an actually-lapsed link deserves.
  it("routes a lapsed session to the expired-link copy, not a bare 'Not authorized'", async () => {
    mockCookie();
    fakeAdmin({
      portal_sessions: () => ({ data: null, error: null }),
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(403);
    expect(body.error).toBe(PORTAL_COPY.errorExpired);
  });

  it("refuses a link with no vendor_id WITHOUT ever querying deliveries", async () => {
    mockCookie();
    const admin = fakeAdmin({
      portal_sessions: () => ({ data: VALID_SESSION, error: null }),
      portal_links: () => ({ data: { ...LINK_WITH_VENDOR, vendor_id: null }, error: null }),
      // Deliberately no "titles" or "deliveries" handler: if the route queries either before
      // returning, fakeTable throws and fails the test loudly rather than passing by accident.
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));

    expect(res.status).toBe(403);
    expect(admin.from).not.toHaveBeenCalledWith("deliveries");
    expect(admin.from).not.toHaveBeenCalledWith("titles");
  });

  it("does not license a delivery that exists for a DIFFERENT vendor", async () => {
    mockCookie();
    // Everything downstream of the licence check is deliberately made to SUCCEED here (a real
    // master asset, an available restore, a working signer, a clean audit insert) so that 403
    // can ONLY come from the licence gate itself. A version of this test that also lacked a
    // master asset would still return 403 even if the vendor scope were silently dropped —
    // masked by the separate "no master asset" gate rather than caught by this one. Confirmed
    // by actually deleting `.eq("vendor_id", ...)` from the route: with a master asset present
    // (as here), the test then fails with 200 instead of 403; with no master asset (the
    // earlier version), it stayed green — see task-9-report.md, fix round 2.
    vi.mocked(resolveOrRestore).mockResolvedValue({ status: "available" });
    vi.mocked(assetViewUrl).mockResolvedValue("https://signed.example/master");

    // The only delivery in the world for this title is for vendor-OTHER, not this link's
    // vendor-1. The handler applies ONLY the filters actually recorded: an absent filter key
    // is PERMISSIVE, the way an omitted `.eq()` in a real query would be — so if the route
    // ever dropped `.eq("vendor_id", ...)`, `filters` would have no "vendor_id" key, every()
    // would pass on title_id alone, and this vendor-OTHER row would wrongly surface and
    // license the buyer. (Comparing against `filters.vendor_id` directly, as an earlier
    // version of this test did, is `undefined` when the filter is absent — exactly as
    // "not equal" as a real mismatch, so that version could not tell the two cases apart.)
    const allDeliveries = [
      { title_id: "title-1", vendor_id: "vendor-OTHER", status: "live", territory: "US", rights_grants: WORLD_GRANT },
    ];
    fakeAdmin({
      portal_sessions: () => ({ data: VALID_SESSION, error: null }),
      portal_links: () => ({ data: LINK_WITH_VENDOR, error: null }),
      titles: () => ({ data: { status: "live" }, error: null }),
      deliveries: (filters) => ({
        data: allDeliveries.filter((d) =>
          Object.entries(filters).every(([k, v]) => (d as Record<string, unknown>)[k] === v),
        ),
        error: null,
      }),
      assets: () => ({ data: { storage_key: "orgs/o1/titles/title-1/master/x/file.mov" }, error: null }),
      portal_access_events: () => ({ data: null, error: null }),
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));

    expect(res.status).toBe(403);
  });

  it("licenses correctly-scoped delivery but still refuses when the audit insert fails, and never returns a url", async () => {
    mockCookie();
    vi.mocked(resolveOrRestore).mockResolvedValue({ status: "available" });
    vi.mocked(assetViewUrl).mockResolvedValue("https://signed.example/master");

    fakeAdmin({
      portal_sessions: () => ({ data: VALID_SESSION, error: null }),
      portal_links: () => ({ data: LINK_WITH_VENDOR, error: null }),
      titles: () => ({ data: { status: "live" }, error: null }),
      deliveries: (filters) => ({
        data:
          filters.title_id === "title-1" && filters.vendor_id === "vendor-1"
            ? [{ status: "live", territory: "US", rights_grants: WORLD_GRANT }]
            : [],
        error: null,
      }),
      assets: () => ({ data: { storage_key: "orgs/o1/titles/title-1/master/x/file.mov" }, error: null }),
      portal_access_events: () => ({ data: null, error: { message: "insert failed" } }),
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));
    const body = (await res.json()) as { url?: string };

    expect(res.status).toBe(500);
    expect(body.url).toBeUndefined();
  });

  // Fix round 2, item 5: a correctly-scoped, correctly-active delivery is not enough on its
  // own — there must also be a `kind = 'master'` asset row to actually serve. Before this fix
  // buyerActionsFor.canDownloadMaster was `licensed` alone, so page.tsx could render the
  // button for exactly this state and the route would then fail it.
  it("refuses a properly licensed delivery when no master asset exists yet", async () => {
    mockCookie();
    fakeAdmin({
      portal_sessions: () => ({ data: VALID_SESSION, error: null }),
      portal_links: () => ({ data: LINK_WITH_VENDOR, error: null }),
      titles: () => ({ data: { status: "live" }, error: null }),
      deliveries: (filters) => ({
        data:
          filters.title_id === "title-1" && filters.vendor_id === "vendor-1"
            ? [{ status: "live", territory: "US", rights_grants: WORLD_GRANT }]
            : [],
        error: null,
      }),
      assets: () => ({ data: null, error: null }),
    });

    const res = await POST(new Request("http://test/", { method: "POST" }));

    expect(res.status).toBe(403);
  });
});
