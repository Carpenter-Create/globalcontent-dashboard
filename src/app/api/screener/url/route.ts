import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { signAssetUrl } from "@/lib/cloudfront";
import { resolveOrRestore } from "@/lib/s3";
import { PORTAL } from "@/lib/portal";

const Body = z.object({ titleId: z.string().uuid() });

// Client screener preview: a signed CloudFront STREAM URL so a rights holder can watch
// their OWN title's screener source. Ownership is enforced by RLS — a normal user-JWT
// select on `titles`/`assets` returns rows ONLY for the caller's org (404 otherwise).
// Mirrors /api/gc/screener-url but user-JWT + RLS instead of the gc_staff gate; like it,
// this is silent (writes NO screener_view_events — engagement tracks external viewers
// only) and signs with the long streaming TTL (the 300s download TTL freezes <video>
// byte-range playback). Signing stays server-side (rule 14); Glacier-aware.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // RLS scopes this to the caller's org — another org's title returns null → 404.
  const { data: title } = await supabase
    .from("titles")
    .select("screener_source")
    .eq("id", parsed.data.titleId)
    .maybeSingle();
  if (!title) return NextResponse.json({ error: "Title not found" }, { status: 404 });

  // Pick the screener source the same way the portal does: the dedicated screener asset
  // if the title is set to 'dedicated', else the master.
  const kind = title.screener_source === "dedicated" ? "screener" : "master";
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
    return NextResponse.json({ url: signAssetUrl(asset.storage_key, PORTAL.screenerStreamTtlSeconds) });
  } catch (e) {
    console.error(`[screener:url] ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Could not prepare the screener. Please try again." }, { status: 502 });
  }
}
