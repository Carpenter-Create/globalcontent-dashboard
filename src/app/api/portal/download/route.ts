import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL } from "@/lib/portal";
import { signAssetUrl } from "@/lib/cloudfront";

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

  let url: string;
  try {
    url = signAssetUrl(row.storage_key);
  } catch {
    // Object not retrievable (e.g. Glacier) or signing misconfig — graceful (Slice-3 seam).
    return NextResponse.json({ error: "File is being prepared" }, { status: 409 });
  }

  await admin.from("portal_access_events").insert({
    link_id: row.link_id,
    session_id: row.session_id,
    event_type: "download",
    user_agent: req.headers.get("user-agent") ?? null,
  });

  return NextResponse.json({ type: "progressive", url });
}
