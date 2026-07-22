import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { signAssetUrl } from "@/lib/cloudfront";
import { resolveOrRestore } from "@/lib/s3";

const Body = z.object({ assetId: z.string().uuid() });

// Client asset viewer/download: a signed CloudFront URL for an asset the caller may read.
// Ownership is enforced by RLS — a normal user-JWT select on `assets` returns the row ONLY
// if the caller's org owns it (returns 404 otherwise). URL signing stays server-side
// (rule 14). Glacier-aware via resolveOrRestore (artwork is on S3 Standard; masters may
// be restoring). Distinct from /api/gc/asset-url (GC staff) and /api/portal/* (OTP).
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: asset } = await supabase
    .from("assets")
    .select("storage_key")
    .eq("id", parsed.data.assetId)
    .maybeSingle();
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  try {
    const restore = await resolveOrRestore(asset.storage_key);
    if (restore.status === "restoring") {
      return NextResponse.json({ restoring: true }, { status: 202 });
    }
    return NextResponse.json({ url: signAssetUrl(asset.storage_key) });
  } catch (e) {
    console.error(`[assets:url] ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Could not prepare the asset. Please try again." }, { status: 502 });
  }
}
