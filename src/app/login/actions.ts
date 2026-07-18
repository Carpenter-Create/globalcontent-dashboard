"use server";

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";

export type LoginState = { ok: boolean; message: string };

// Magic-link only (domain-spec §21 decision): no passwords, no OAuth. Turnstile is
// verified server-side BEFORE we ask Supabase to send the link.
export async function requestMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const token = String(formData.get("cf-turnstile-response") ?? "");

  if (!email) return { ok: false, message: "Enter your email address." };

  if (!(await verifyTurnstile(token))) {
    return { ok: false, message: "Verification failed — please try again." };
  }

  const origin =
    (await headers()).get("origin") ?? "http://127.0.0.1:3000";
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      shouldCreateUser: true, // open free-tier signup (§3: creates a 'registered' org after onboarding)
    },
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Check your email for a secure sign-in link." };
}
