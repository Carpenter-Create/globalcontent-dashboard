import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { signAssetUrl } from "@/lib/cloudfront";
import { resolveOrRestore } from "@/lib/s3";

const Body = z.object({ assetId: z.string().uuid() });

// GC internal asset viewer: a signed CloudFront URL for ANY asset, for authenticated
// GC staff (is_gc_staff) — NO OTP. Distinct from the portal's service-role, OTP-gated
// path (which is for external recipients). Glacier-aware via resolveOrRestore.
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

  // RLS lets GC read any asset; get its storage key.
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
    console.error(`[gc:asset-url] ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Could not prepare the asset. Please try again." }, { status: 502 });
  }
}
