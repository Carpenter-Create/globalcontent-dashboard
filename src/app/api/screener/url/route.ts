import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { signAssetUrl } from "@/lib/cloudfront";
import { resolveOrRestore } from "@/lib/s3";
import { PORTAL } from "@/lib/portal";

const Body = z.object({ titleId: z.string().uuid() });

// In-app screener preview. Signed CloudFront STREAM URL for a title the caller may read.
// Ownership is enforced by RLS — a user-JWT select on `titles`/`assets` returns rows only
// for the caller's org (404 otherwise; verified cross-org). Signing stays server-side
// (rule 14). Glacier-aware. Writes NO screener_view_events — that table tracks external
// portal viewers, not internal preview.
//
// ── The split, and why ────────────────────────────────────────────────────────────────
// There is no transcoding, watermarking or DRM anywhere in this codebase (by design —
// clients deliver platform-ready). So when a title sits on the screener_source = 'master'
// default, the "screener" is not a proxy of the master: it IS the master, the same S3
// object byte for byte. Handing that to a browser as a signed URL produces a plain
// forwardable bearer credential to an unwatermarked master.
//
// Who may do that is now split:
//
//   gc_staff — keeps the master fallback. Screening a title is how GC performs the
//              chain-of-title review, and reviewers work on titles that are in_review with
//              no dedicated screener; removing it would break the review the gate exists
//              to protect. Small, named, employed population.
//
//   client   — dedicated screener only. `assets_select` gates on member_can(...,'view'),
//              which admits ALL FIVE org roles including `viewer`, a role CLAUDE.md scopes
//              to "catalog read-only". Without this split any seated viewer could mint an
//              unwatermarked master URL for their org's entire catalogue.
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
    .select("screener_source")
    .eq("id", parsed.data.titleId)
    .maybeSingle();
  if (!title) return NextResponse.json({ error: "Title not found" }, { status: 404 });

  const dedicated = title.screener_source === "dedicated";

  // A client may only ever be served a dedicated screener asset; staff may fall back to the
  // master. This is about WHICH FILE is served, not org scope — RLS settled that above.
  if (!dedicated && !isGcStaff) {
    return NextResponse.json(
      { error: "A dedicated screener has not been uploaded for this title yet." },
      { status: 404 },
    );
  }

  const kind = dedicated ? "screener" : "master";
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
    return NextResponse.json({ url: signAssetUrl(asset.storage_key, PORTAL.inAppScreenerTtlSeconds) });
  } catch (e) {
    console.error(`[screener:url] ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Could not prepare the screener. Please try again." }, { status: 502 });
  }
}
