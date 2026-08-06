import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL } from "@/lib/portal";
import { assetViewUrl } from "@/lib/asset-url";
import { resolveOrRestore } from "@/lib/s3";
import { buyerActionsFor } from "@/lib/buyer-page";

// Buyer-portal screener download — backs the "Download screener" button on the title page
// (title-page.tsx). Modeled on src/app/api/portal/download/route.ts for the Glacier gate,
// the audit-before-return ordering, and the fail-closed shape.
//
// Session + asset resolution reuses portal_resolve_screener (screener_view links) rather
// than re-deriving it here: that RPC already re-checks session/link validity and resolves
// the CURRENT source asset (dedicated screener vs master fallback, keyed off the title's
// live screener_source) the same way the in-room player and /api/portal/screener do — one
// place decides "which file IS the screener," not three.
//
// portal_resolve_screener deliberately carries NO title-status gate (it also backs the
// in-room player, which must work for GC reviewers pre-approval — screening IS the
// chain-of-title review). A DOWNLOAD is a stronger act than an in-room watch, so this route
// adds the one check the RPC omits on purpose: buyerActionsFor's canDownloadScreener,
// recomputed here from the title's CURRENT status. Never trust the page that rendered the
// button — recompute from freshly-read state, same rule the master route applies below it
// in the same file tree.
export async function POST(req: Request) {
  const raw = (await cookies()).get(PORTAL.sessionCookie)?.value;
  if (!raw) return NextResponse.json({ error: "No session" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_resolve_screener", { p_session_token_hash: hashToken(raw) });
  // RPC returns a set; grab the first row. Any auth failure raises → error is set.
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // A successful resolve already proves a screener-kind asset exists (the RPC raises
  // otherwise), so hasScreenerAsset is true by construction here. hasTrailer/licensed don't
  // feed canDownloadScreener; they're passed as safe defaults rather than left undefined.
  const { data: titleRow } = await admin.from("titles").select("status").eq("id", row.title_id).maybeSingle();
  const actions = buyerActionsFor({
    titleStatus: titleRow?.status ?? null,
    hasScreenerAsset: true,
    hasTrailer: false,
    licensed: false,
  });
  if (!actions.canDownloadScreener) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
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
  } catch {
    // Signing misconfig (env) — graceful; the Glacier case is handled above.
    return NextResponse.json({ error: "File is being prepared" }, { status: 409 });
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
