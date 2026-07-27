import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { signAssetUrl } from "@/lib/cloudfront";
import { resolveOrRestore } from "@/lib/s3";

const Body = z.object({ assetId: z.string().uuid() });

// Kinds this route may sign. Deliberately an ALLOW-list: a new asset_kind added by a future
// migration is unreachable here until someone consciously adds it, rather than becoming
// downloadable the moment the enum grows.
//
// `master` and `screener` are excluded. RLS scopes this route to the caller's own org and
// that holds (verified: cross-org requests 404), but `assets_select` gates on
// member_can(...,'view'), which admits ALL FIVE org roles including `viewer` — a role
// CLAUDE.md scopes to "catalog read-only". Without this filter any viewer could mint a
// signed URL for the master. That matters more than it looks: the signed-URL expiry is
// checked when the request is RECEIVED, not while it streams (measured — a 10s URL
// happily ran a 30s transfer to completion), so a 300s URL starts a download that finishes
// whenever it finishes. The master reaches vendors through the OTP-gated portal, which
// re-checks delivery status and the rights grant per request; it does not need a
// second, unaudited path through a client button.
const CLIENT_VIEWABLE_KINDS = ["poster", "banner", "artwork", "caption"] as const;

// Client asset viewer/download: a signed CloudFront URL for an asset the caller may read.
// Ownership is enforced by RLS — a normal user-JWT select on `assets` returns the row ONLY
// if the caller's org owns it (returns 404 otherwise). URL signing stays server-side
// (rule 14). Glacier-aware via resolveOrRestore. Distinct from /api/gc/asset-url (GC staff)
// and /api/portal/* (OTP).
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
    .select("storage_key, kind")
    .eq("id", parsed.data.assetId)
    .maybeSingle();
  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  // Same 404 as "not yours" on purpose — a distinct code would confirm the id exists.
  if (!(CLIENT_VIEWABLE_KINDS as readonly string[]).includes(asset.kind)) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }

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
