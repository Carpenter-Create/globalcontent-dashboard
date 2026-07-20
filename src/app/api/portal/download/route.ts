import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL } from "@/lib/portal";
import { signAssetUrl } from "@/lib/cloudfront";
import { resolveOrRestore } from "@/lib/s3";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const raw = cookieStore.get(PORTAL.sessionCookie)?.value;
  if (!raw) return NextResponse.json({ error: "No session" }, { status: 401 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_resolve_download", {
    p_session_token_hash: hashToken(raw),
  });
  // RPC returns a set; grab the first row. Any auth failure raises → error is set.
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // Glacier gate: a master tiered to cold storage must be restored before it can be served.
  // resolveOrRestore HEADs the object (source of truth) and auto-initiates a Standard restore
  // on first hit. "restoring" → 409 "preparing"; the recipient returns to the same link.
  const restore = await resolveOrRestore(row.storage_key);
  if (restore.status === "restoring") {
    if (restore.justInitiated) {
      // best-effort provenance — a log failure must NOT turn "preparing" into an error
      await admin.from("portal_access_events").insert({
        link_id: row.link_id,
        session_id: row.session_id,
        event_type: "restore_requested",
        user_agent: req.headers.get("user-agent") ?? null,
      });
    }
    return NextResponse.json({ error: "File is being prepared" }, { status: 409 });
  }

  let url: string;
  try {
    url = signAssetUrl(row.storage_key);
  } catch {
    // Signing misconfig (env) — graceful; the Glacier case is handled above.
    return NextResponse.json({ error: "File is being prepared" }, { status: 409 });
  }

  // The download event is THE provenance record for "who downloaded the master" (rule 5).
  // If we can't record it, fail closed rather than serve an unauditable master — the client
  // never receives the (as-yet-unused) signed URL, so no untraceable download can occur.
  const { error: logErr } = await admin.from("portal_access_events").insert({
    link_id: row.link_id,
    session_id: row.session_id,
    event_type: "download",
    user_agent: req.headers.get("user-agent") ?? null,
  });
  if (logErr) return NextResponse.json({ error: "Could not record access" }, { status: 500 });

  return NextResponse.json({ type: "progressive", url });
}
