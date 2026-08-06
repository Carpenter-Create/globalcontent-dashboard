import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, hashOtp, generateOtpCode, PORTAL, requestOtpBodySchema } from "@/lib/portal";
import { sendOtpEmail } from "@/lib/email";
import { verifyTurnstile } from "@/lib/turnstile";

export async function POST(req: Request) {
  const parsed = requestOtpBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { token, name, company } = parsed.data;
  // Normalize email so casing/whitespace can't split room_viewed dedup or break verify-otp matching.
  const email = parsed.data.email.trim().toLowerCase();

  // Layer 1 — Turnstile: this endpoint sends real email to a self-supplied address, so require a
  // human challenge before any DB work (same pattern as /login's magic-link send).
  if (!(await verifyTurnstile(parsed.data.turnstileToken))) {
    return NextResponse.json({ error: "Verification failed" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("portal_links")
    .select("id, expires_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!link || link.revoked_at || new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ error: "Link expired or withdrawn" }, { status: 404 });
  }

  // Layers 2 & 3 — issuance caps (rolling 1h): per (link,email) bounds same-address spam + the
  // attempts-reset hole; per link bounds using one link to email many arbitrary addresses.
  const sinceIso = new Date(Date.now() - 3_600_000).toISOString();
  const { count: perEmail } = await admin
    .from("portal_otps")
    .select("id", { count: "exact", head: true })
    .eq("link_id", link.id)
    .eq("email", email)
    .gte("created_at", sinceIso);
  if ((perEmail ?? 0) >= PORTAL.otpPerEmailPerHour) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const { count: perLink } = await admin
    .from("portal_otps")
    .select("id", { count: "exact", head: true })
    .eq("link_id", link.id)
    .gte("created_at", sinceIso);
  if ((perLink ?? 0) >= PORTAL.otpPerLinkPerHour) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const ua = req.headers.get("user-agent") ?? null;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // First contact for this link+email → record room_viewed once.
  const { count } = await admin
    .from("portal_access_events")
    .select("id", { count: "exact", head: true })
    .eq("link_id", link.id)
    .eq("event_type", "room_viewed")
    .eq("email", email);
  if (!count) {
    await admin.from("portal_access_events").insert({
      link_id: link.id, event_type: "room_viewed", email, name, company, ip, user_agent: ua,
    });
  }

  const code = generateOtpCode();
  await admin.from("portal_otps").insert({
    link_id: link.id,
    email,
    code_hash: hashOtp(code, link.id),
    expires_at: new Date(Date.now() + PORTAL.otpTtlMinutes * 60_000).toISOString(),
  });
  await sendOtpEmail(email, code);
  await admin.from("portal_access_events").insert({
    link_id: link.id, event_type: "otp_sent", email, name, company, ip, user_agent: ua,
  });

  return NextResponse.json({ ok: true });
}
