"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { renderAgreement, hashAgreement, TERMS_VERSION, TIERS, type Tier } from "@/lib/agreements";

// Clickwrap accept. Renders + hashes the agreement server-side (content_hash covers the exact
// text the client saw — the render is deterministic, so we never trust client-sent text), then
// calls the accept_terms RPC. Free → active. Paid → awaiting_payment, then our on-domain
// payment page (embedded Payment Element, PAY1) — never a hosted redirect.
export async function acceptAgreement(formData: FormData) {
  const tier = String(formData.get("tier") ?? "") as Tier;
  if (!TIERS.includes(tier)) throw new Error("Invalid tier");

  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const rendered = renderAgreement(tier);
  const contentHash = hashAgreement(rendered);
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
  const userAgent = h.get("user-agent") || undefined;

  const { data, error } = await supabase.rpc("accept_terms", {
    p_tier: tier,
    p_terms_version: TERMS_VERSION,
    p_content_hash: contentHash,
    p_rendered_text: rendered,
    p_ip: ip,
    p_user_agent: userAgent,
  });
  if (error) throw new Error(error.message);

  const result = data as { org_id: string; source_document_id: string; needs_payment: boolean };
  redirect(result.needs_payment ? "/onboarding/payment" : "/?welcome=1");
}
