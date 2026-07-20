import "server-only";
import { Resend } from "resend";
import { PORTAL } from "@/lib/portal";

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
