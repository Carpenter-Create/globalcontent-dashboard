import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL } from "@/lib/portal";
import { signAssetUrl } from "@/lib/cloudfront";

export async function POST() {
  const raw = (await cookies()).get(PORTAL.sessionCookie)?.value;
  if (!raw) return NextResponse.json({ error: "No session" }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_resolve_screener", { p_session_token_hash: hashToken(raw) });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  let url: string;
  try { url = signAssetUrl(row.storage_key); }
  catch { return NextResponse.json({ error: "File is being prepared" }, { status: 409 }); }
  return NextResponse.json({ type: "progressive", url });
}
