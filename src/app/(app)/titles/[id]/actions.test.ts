import { describe, expect, it, vi, beforeEach } from "vitest";

// No existing test in this repo mocks the Supabase server client (checked: `vi.mock` appears
// only once, in lib/asset-url.test.ts, for a different module). This is the smallest mock that
// covers what createBuyerScreenerLink actually calls — a chainable `.from()` query builder and
// `.rpc()` — built local to this file rather than as shared test infrastructure, per the brief.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ getAuthUser: vi.fn() }));
// revalidatePath touches Next's request-scoped cache store, which doesn't exist outside a real
// request — irrelevant to the branching under test, so it's stubbed out rather than exercised.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { createBuyerScreenerLink } from "./actions";

type Candidate = { recipient_name: string; expires_at?: string };

// A chainable stand-in for the PostgREST query builder: every passthrough filter method returns
// the same object, and awaiting it (Promise.all does this via `.then`) resolves to the
// (possibly `.gt()`-narrowed) result — the shape
// `.select().eq().eq().is().gt().ilike().limit()` needs without a real client.
//
// `.gt()` actually filters, unlike the other methods: it's the one fix round 3, item 7 added
// (excluding expired links from the collision check), so it's the one worth proving actually
// narrows the candidate set rather than trusting the call happened.
function fakeQuery(rows: Candidate[], error: { message: string } | null = null) {
  let result = rows;
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "ilike", "limit", "order"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.gt = vi.fn((col: string, val: string) => {
    result = result.filter((r) => {
      const v = (r as unknown as Record<string, unknown>)[col];
      // A fixture with no expires_at at all is the common case for tests that aren't about
      // expiry — treat it as "still live" so those tests don't have to set a far-future
      // timestamp just to avoid being filtered out here.
      if (v === undefined) return true;
      return typeof v === "string" && v > val;
    });
    return builder;
  });
  builder.maybeSingle = vi.fn(async () => ({ data: result[0] ?? null, error }));
  builder.then = (
    resolve: (v: { data: Candidate[]; error: typeof error }) => void,
    reject: (e: unknown) => void,
  ) => Promise.resolve({ data: result, error }).then(resolve, reject);
  return builder;
}

// Unification (20260806000300): the collision check no longer looks up gc_staff or narrows by
// created_by — one active link per (title, recipient), whoever created it — so this fake only
// ever needs to answer for "portal_links".
function fakeSupabase(opts: { candidates?: Candidate[]; rpcError?: string }) {
  const rpc = vi.fn(async () =>
    opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: "link-id", error: null },
  );
  const from = vi.fn((table: string) => {
    if (table === "portal_links") return fakeQuery(opts.candidates ?? []);
    throw new Error(`fakeSupabase: unexpected table "${table}"`);
  });
  return { from, rpc };
}

const USER = { id: "client-user-1", email: "client@example.com" };

beforeEach(() => {
  vi.mocked(getAuthUser).mockResolvedValue(USER);
});

describe("createBuyerScreenerLink — collision branching", () => {
  // This is the assertion that matters: the founder's requirement is that a colliding name is
  // refused WITHOUT the RPC's revoke-then-create ever running, because that's what silently
  // kills the existing buyer's URL.
  it("collision, no replace: returns the warning and never calls the RPC", async () => {
    const supabase = fakeSupabase({
      candidates: [{ recipient_name: "Tubi" }],
    });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);

    const res = await createBuyerScreenerLink({ titleId: "t1", recipientName: "tubi" });

    expect(res.error).toBe(
      "A link for Tubi already exists. Use Replace link on that buyer to send a new URL, or enter a different name.",
    );
    expect(res.url).toBeUndefined();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("collision, replace: true: skips the check and calls the RPC", async () => {
    const supabase = fakeSupabase({
      candidates: [{ recipient_name: "Tubi" }],
    });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);

    const res = await createBuyerScreenerLink({ titleId: "t1", recipientName: "Tubi", replace: true });

    expect(res.error).toBeUndefined();
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    // replace:true is the deliberate path — it must not even query for a collision.
    expect(supabase.from).not.toHaveBeenCalledWith("portal_links");
  });

  it("no collision: calls the RPC and returns a url", async () => {
    const supabase = fakeSupabase({ candidates: [] });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);

    const res = await createBuyerScreenerLink({ titleId: "t1", recipientName: "Roku" });

    expect(res.error).toBeUndefined();
    expect(res.url).toContain("/portal/");
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  // Fix round 3, item 7: the collision check used to filter only `revoked_at is null`, ignoring
  // expiry — so an EXPIRED (but never revoked) link for "Tubi" blocked a fresh create behind an
  // unnecessary "Use Replace link" warning, even though the old URL is already dead to the
  // buyer and create_screener_link's own match predicate would have replaced it with no live
  // link actually being destroyed.
  it("an EXPIRED candidate does not count as a collision — the RPC runs directly", async () => {
    const supabase = fakeSupabase({
      candidates: [{ recipient_name: "Tubi", expires_at: "2020-01-01T00:00:00.000Z" }],
    });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);

    const res = await createBuyerScreenerLink({ titleId: "t1", recipientName: "Tubi" });

    expect(res.error).toBeUndefined();
    expect(res.url).toContain("/portal/");
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("empty/whitespace-only name: refuses before ever querying", async () => {
    const supabase = fakeSupabase({});
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);

    const res = await createBuyerScreenerLink({ titleId: "t1", recipientName: "   " });

    expect(res.error).toBe("Enter the buyer's name.");
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
