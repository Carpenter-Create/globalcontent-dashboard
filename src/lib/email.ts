import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PORTAL } from "@/lib/portal";
import type { Database } from "@/lib/supabase/database.types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildOtpEmail(code: string): { subject: string; text: string; html: string } {
  const subject = "Your Global Content access code";
  const text =
    `Your verification code is ${code}.\n\n` +
    `It expires in ${PORTAL.otpTtlMinutes} minutes. If you didn't request this, you can ignore this message.`;
  const html =
    `<p>Your verification code is</p>` +
    `<p style="font-size:24px;font-weight:600;letter-spacing:2px">${code}</p>` +
    `<p>It expires in ${PORTAL.otpTtlMinutes} minutes. If you didn't request this, you can ignore this message.</p>`;
  return { subject, text, html };
}

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PORTAL_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Missing RESEND_API_KEY or PORTAL_EMAIL_FROM");
  const { subject, text, html } = buildOtpEmail(code);
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({ from, to, subject, text, html });
  if (error) throw new Error(`Email send failed: ${error.message}`);
}

// GC-Support notification email (§20). Body is the same voice-approved line shown in-app;
// this frames it with a CTA back into the dashboard and the sign-off. Copy lives in
// lib/notifications.ts (subject/CTA per kind) — this is just the template. body is escaped
// because it carries user content (title, rejection reason).
export function buildNotificationEmail(args: {
  subject: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
}): { subject: string; text: string; html: string } {
  const { subject, body, ctaLabel, ctaUrl } = args;
  const text = `${body}\n\n${ctaLabel}: ${ctaUrl}\n\nGlobal Content`;
  const html =
    `<p>${escapeHtml(body)}</p>` +
    `<p><a href="${ctaUrl}">${escapeHtml(ctaLabel)}</a></p>` +
    `<p style="color:#6b7280">Global Content</p>`;
  return { subject, text, html };
}

async function sendNotificationEmail(
  to: string,
  msg: { subject: string; text: string; html: string },
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PORTAL_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Missing RESEND_API_KEY or PORTAL_EMAIL_FROM");
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({ from, to, subject: msg.subject, text: msg.text, html: msg.html });
  if (error) throw new Error(`Email send failed: ${error.message}`);
}

// Send a GC-Support notification email to every active member of an org. Recipients come from
// the GC-gated org_notification_recipients RPC (called with the operator's JWT — no service-role
// here). Best-effort: a missing config or a failed send logs and is swallowed, so it can never
// break the GC action that triggered it (the in-app notification already committed).
export async function sendOrgNotificationEmail(
  supabase: SupabaseClient<Database>,
  orgId: string,
  msg: { subject: string; body: string; ctaLabel: string; ctaPath: string },
): Promise<void> {
  const { data: recipients, error } = await supabase.rpc("org_notification_recipients", { p_org_id: orgId });
  if (error || !recipients || recipients.length === 0) return;
  const base = process.env.PORTAL_BASE_URL?.replace(/\/+$/, "") ?? "";
  const email = buildNotificationEmail({
    subject: msg.subject,
    body: msg.body,
    ctaLabel: msg.ctaLabel,
    ctaUrl: `${base}${msg.ctaPath}`,
  });
  await Promise.all(
    recipients.map((to) =>
      sendNotificationEmail(to, email).catch((e) =>
        console.error("[notifications] email send failed", e instanceof Error ? e.message : e),
      ),
    ),
  );
}
