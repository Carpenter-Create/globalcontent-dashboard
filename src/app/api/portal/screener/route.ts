import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL, PORTAL_COPY } from "@/lib/portal";
import { assetViewUrl } from "@/lib/asset-url";
import { resolveOrRestore } from "@/lib/s3";
import {
  asPortalResolvedScreener,
  isDedicatedScreenerAsset,
} from "@/lib/portal-resolve-screener";

export async function POST(req: Request) {
  const raw = (await cookies()).get(PORTAL.sessionCookie)?.value;
  if (!raw) return NextResponse.json({ error: "No session" }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_resolve_screener", { p_session_token_hash: hashToken(raw) });
  const row = asPortalResolvedScreener(Array.isArray(data) ? data[0] : data);
  // The RPC raises when the SESSION itself (not the dedicated-asset gate below) is gone —
  // expired, revoked, or the link it points at is expired/revoked. Distinct copy from the
  // dedicated-asset gate's 403 below.
  if (error || !row) return NextResponse.json({ error: PORTAL_COPY.errorExpired }, { status: 403 });

  // Dedicated-asset gate — authorize on the RESOLVED asset from the same RPC snapshot
  // (asset_kind), not a second titles.screener_source read. A concurrent master→dedicated
  // flip must not make an already-resolved MASTER key signable (TOCTOU / Option D).
  // Named and unnamed portal links follow the same rule. buyer-page.ts mirrors this for UI.
  if (!isDedicatedScreenerAsset(row)) {
    return NextResponse.json({ error: PORTAL_COPY.screenerStreamUnavailableNotice }, { status: 403 });
  }

  // Glacier gate: defense in depth if a screener object were ever cold. Dedicated proxies are
  // S3 Standard and resolve to "available" immediately.
  const restore = await resolveOrRestore(row.storage_key);
  if (restore.status === "restoring") {
    if (restore.justInitiated) {
      try {
        await admin.from("portal_access_events").insert({
          link_id: row.link_id,
          session_id: row.session_id,
          event_type: "restore_requested",
          user_agent: req.headers.get("user-agent") ?? null,
        });
      } catch {
        /* swallow — provenance is best-effort here */
      }
    }
    return NextResponse.json({ error: "File is being prepared" }, { status: 409 });
  }

  let url: string;
  // Long TTL: range-based <video> playback re-validates the signed URL on every byte-range
  // request across the whole runtime, so a short (download-style) TTL would 403 mid-film.
  try { url = await assetViewUrl(row.storage_key, PORTAL.screenerStreamTtlSeconds); }
  catch { return NextResponse.json({ error: "File is being prepared" }, { status: 409 }); }
  return NextResponse.json({ type: "progressive", url });
}
