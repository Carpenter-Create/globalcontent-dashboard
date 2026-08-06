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

type Candidate = { recipient_name: string };

// A chainable stand-in for the PostgREST query builder: every filter method returns the same
// object, and awaiting it (Promise.all does this via `.then`) resolves to the fixed result —
// exactly the shape `.select().eq().eq().is().ilike().limit()` needs without a real client.
function fakeQuery<T>(data: T, error: { message: string } | null = null) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "ilike", "limit", "order"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => ({ data, error }));
  builder.then = (
    resolve: (v: { data: T; error: typeof error }) => void,
    reject: (e: unknown) => void,
  ) => Promise.resolve({ data, error }).then(resolve, reject);
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

  it("empty/whitespace-only name: refuses before ever querying", async () => {
    const supabase = fakeSupabase({});
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);

    const res = await createBuyerScreenerLink({ titleId: "t1", recipientName: "   " });

    expect(res.error).toBe("Enter the buyer's name.");
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
