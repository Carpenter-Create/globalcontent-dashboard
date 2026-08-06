import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { assetViewUrl } from "@/lib/asset-url";
import { screenerKindFor } from "@/lib/assets";
import { resolveOrRestore } from "@/lib/s3";
import { PORTAL } from "@/lib/portal";

const Body = z.object({ titleId: z.string().uuid() });

// In-app screener preview. Signed CloudFront STREAM URL for a title the caller may read.
// Ownership is enforced by RLS — a user-JWT select on `titles`/`assets` returns rows only
// for the caller's org (404 otherwise; verified cross-org). Signing stays server-side
// (rule 14). Glacier-aware. Writes NO screener_view_events — that table tracks external
// portal viewers, not internal preview.
//
// Who may be served WHICH FILE is decided by screenerKindFor (lib/assets) — the same call
// the title page makes to decide whether to render the Watch button, so the two cannot
// drift. In short: staff any status, clients any org role once GC has approved the title.
// See that function for the reasoning.
//
// Same gc_staff check as /api/gc/screener-url:23-28, so the two routes agree on who staff
// are rather than each deciding for itself.
//
// TTL is cut from the portal's 6h to 2h on BOTH branches (PORTAL.inAppScreenerTtlSeconds).
//
// NOT HERE, deliberately: per-issuance logging. Writing it needs a SECURITY DEFINER RPC —
// audit_log is trigger-populated with no INSERT policy — so it ships with the migration
// batch rather than being bolted on here. Nobody is seated yet, so there is nothing to log
// until onboarding.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: staff } = await supabase
    .from("gc_staff")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const isGcStaff = Boolean(staff);

  // RLS scopes this to the caller's org — another org's title returns null → 404.
  // GC staff span all orgs by design (member_can short-circuits on is_gc_staff).
  const { data: title } = await supabase
    .from("titles")
    .select("screener_source, status")
    .eq("id", parsed.data.titleId)
    .maybeSingle();
  if (!title) return NextResponse.json({ error: "Title not found" }, { status: 404 });

  // WHICH FILE this caller gets, or null to refuse. Not org scope — RLS settled that above.
  const kind = screenerKindFor(title.screener_source, isGcStaff, title.status);
  if (!kind) {
    return NextResponse.json(
      { error: "This title's screener is available once GC has approved it." },
      { status: 404 },
    );
  }
  const { data: asset } = await supabase
    .from("assets")
    .select("storage_key")
    .eq("title_id", parsed.data.titleId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!asset) return NextResponse.json({ error: "No screener source uploaded yet." }, { status: 404 });

  try {
    const restore = await resolveOrRestore(asset.storage_key);
    if (restore.status === "restoring") {
      return NextResponse.json({ restoring: true }, { status: 202 });
    }
    return NextResponse.json({ url: await assetViewUrl(asset.storage_key, PORTAL.inAppScreenerTtlSeconds) });
  } catch (e) {
    console.error(`[screener:url] ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Could not prepare the screener. Please try again." }, { status: 502 });
  }
}
