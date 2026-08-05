import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL } from "@/lib/portal";
import { assetViewUrl } from "@/lib/asset-url";
import { resolveOrRestore } from "@/lib/s3";

export async function POST(req: Request) {
  const raw = (await cookies()).get(PORTAL.sessionCookie)?.value;
  if (!raw) return NextResponse.json({ error: "No session" }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_resolve_screener", { p_session_token_hash: hashToken(raw) });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // Glacier gate: a master-source screener may be in cold storage. resolveOrRestore HEADs the
  // object and auto-initiates a Standard restore on first hit; "restoring" → 409 "preparing".
  // (Dedicated screeners live on S3 Standard and resolve to "available" immediately.)
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
  // Long TTL: range-based <video> playback re-validates the signed URL on every byte-range
  // request across the whole runtime, so a short (download-style) TTL would 403 mid-film.
  try { url = await assetViewUrl(row.storage_key, PORTAL.screenerStreamTtlSeconds); }
  catch { return NextResponse.json({ error: "File is being prepared" }, { status: 409 }); }
  return NextResponse.json({ type: "progressive", url });
}
