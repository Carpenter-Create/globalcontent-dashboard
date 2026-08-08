import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL, PORTAL_COPY } from "@/lib/portal";
import { assetViewUrl } from "@/lib/asset-url";
import { resolveOrRestore } from "@/lib/s3";
import { buyerActionsFor } from "@/lib/buyer-page";
import {
  asPortalResolvedScreener,
  isDedicatedScreenerAsset,
} from "@/lib/portal-resolve-screener";

// Buyer-portal screener download — backs the "Download screener" button on the title page
// (title-page.tsx). Modeled on src/app/api/portal/download/route.ts for the Glacier gate,
// the audit-before-return ordering, and the fail-closed shape.
//
// Session + asset resolution reuses portal_resolve_screener. Dedicated-ness for the FILE is
// authorized from row.asset_kind (same RPC snapshot) — not a separately timed
// titles.screener_source read (TOCTOU close, 20260808000200). Title STATUS for the download
// gate (approval / withdrawn) is still re-read here; that is independent of which bytes
// were resolved.
export async function POST(req: Request) {
  const raw = (await cookies()).get(PORTAL.sessionCookie)?.value;
  if (!raw) return NextResponse.json({ error: "No session" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_resolve_screener", { p_session_token_hash: hashToken(raw) });
  const row = asPortalResolvedScreener(Array.isArray(data) ? data[0] : data);
  if (error || !row) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // Never sign a master key for screener download — same Option D / TOCTOU invariant as stream.
  // Watch is also refused for this resolved asset; do not claim download-only unavailability.
  if (!isDedicatedScreenerAsset(row)) {
    return NextResponse.json(
      { error: PORTAL_COPY.screenerDownloadUnavailableNotice },
      { status: 403 },
    );
  }

  const [{ data: titleRow }, { data: linkRow, error: linkError }] = await Promise.all([
    admin.from("titles").select("status").eq("id", row.title_id).maybeSingle(),
    admin.from("portal_links").select("recipient_name").eq("id", row.link_id).maybeSingle(),
  ]);
  const actions = buyerActionsFor({
    titleStatus: titleRow?.status ?? null,
    hasScreenerAsset: true,
    licensed: false,
    screenerIsDedicated: true, // proven by resolved asset_kind above
    hasMasterAsset: false,
    hasRecipientName: linkError ? true : Boolean(linkRow?.recipient_name),
  });
  if (!actions.canDownloadScreener) {
    return NextResponse.json(
      { error: "This file is available to watch but not to download for this title." },
      { status: 403 },
    );
  }

  // Glacier gate: a master-source screener may be in cold storage. resolveOrRestore HEADs
  // the object (source of truth) and auto-initiates a Standard restore on first hit.
  // "restoring" → 409 "preparing"; the recipient returns to the same link.
  const restore = await resolveOrRestore(row.storage_key);
  if (restore.status === "restoring") {
    if (restore.justInitiated) {
      // best-effort provenance — a log failure (error OR thrown) must NOT turn "preparing"
      // into an error; the restore has already been initiated.
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
  try {
    // Single-GET download TTL, not the streaming TTL: this is a file download, not a
    // <video> issuing byte-range requests across a whole playback session.
    url = await assetViewUrl(row.storage_key, PORTAL.signedUrlTtlSeconds);
  } catch (err) {
    // A signing failure here is a CONFIG problem (missing/misconfigured CloudFront env), not
    // "still restoring" — the Glacier case is handled above and never reaches this catch.
    // Masquerading it as 409 would render the page's cold-storage copy ("usually takes 3 to
    // 5 hours") over what is actually a deploy-config bug that will never resolve on its own.
    console.error("[portal:screener-download] signing failed", err);
    return NextResponse.json({ error: "Could not prepare download" }, { status: 500 });
  }

  // The download event is part of THE provenance record (rule 5). If we can't record it,
  // fail closed rather than serve an unauditable download — the client never receives the
  // (as-yet-unused) signed URL, so no untraceable download can occur. Same reasoning as the
  // existing /api/portal/download route.
  const { error: logErr } = await admin.from("portal_access_events").insert({
    link_id: row.link_id,
    session_id: row.session_id,
    event_type: "download",
    user_agent: req.headers.get("user-agent") ?? null,
  });
  if (logErr) return NextResponse.json({ error: "Could not record access" }, { status: 500 });

  return NextResponse.json({ type: "progressive", url });
}
