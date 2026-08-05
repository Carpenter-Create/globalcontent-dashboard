import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { signAssetUrl } from "@/lib/cloudfront";
import { resolveOrRestore } from "@/lib/s3";
import { PORTAL } from "@/lib/portal";

const Body = z.object({ titleId: z.string().uuid() });

// GC internal screener preview: a signed CloudFront STREAM URL for a title's screener source,
// for authenticated GC staff (is_gc_staff) — NO OTP, and it writes NO screener_view_events
// (a silent internal preview; the external Viewer-activity record stays "genuine outside
// viewers only"). Mirrors /api/gc/asset-url but resolves the asset by title + screener_source
// the same way portal_resolve_screener does, and signs with the long streaming TTL (the 300s
// download TTL freezes <video> byte-range playback). Glacier-aware via resolveOrRestore.
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
  if (!staff) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // RLS lets GC read any title/asset. Pick the screener source the same way the portal does:
  // a dedicated screener asset if the title is set to 'dedicated', else the master.
  const { data: title } = await supabase
    .from("titles")
    .select("screener_source")
    .eq("id", parsed.data.titleId)
    .maybeSingle();
  if (!title) return NextResponse.json({ error: "Title not found" }, { status: 404 });

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
    console.error(`[gc:screener-url] ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Could not prepare the screener. Please try again." }, { status: 502 });
  }
}
