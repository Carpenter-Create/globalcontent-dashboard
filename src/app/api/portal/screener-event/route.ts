import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL } from "@/lib/portal";

const Body = z.object({
  event_type: z.enum(["play","pause","seek","progress","ended"]),
  position_seconds: z.number().int().min(0).max(200000),
  runtime_seconds: z.number().int().min(0).max(200000).nullable().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const raw = (await cookies()).get(PORTAL.sessionCookie)?.value;
  if (!raw) return NextResponse.json({ error: "No session" }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_resolve_screener", { p_session_token_hash: hashToken(raw) });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const { error: insErr } = await admin.from("screener_view_events").insert({
    session_id: row.session_id, link_id: row.link_id,
    event_type: parsed.data.event_type, position_seconds: parsed.data.position_seconds,
    runtime_seconds: parsed.data.runtime_seconds ?? null,
  });
  if (insErr) return NextResponse.json({ error: "Could not record" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
