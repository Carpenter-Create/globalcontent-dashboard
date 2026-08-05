import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { stripe } from "@/lib/stripe/server";
import { TIER_META } from "@/lib/agreements";

// Creates a custom (Payment Element) Checkout Session for the caller's awaiting_payment org and
// returns its client_secret. ui_mode 'elements' → embedded on our domain (PAY1). Metadata carries
// what the webhook's finalize_paid_signup needs. No payment_method_types (dynamic methods).
export async function POST() {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name, status)")
    .eq("user_id", user.id)
    .eq("status", "active");
  const org = (memberships ?? []).find((m) => m.role === "account_owner" && m.organizations)
    ?.organizations;
  if (!org || org.status !== "awaiting_payment") {
    return NextResponse.json({ error: "no pending payment" }, { status: 400 });
  }

  // The accepted agreement (source doc) carries the tier + is the id finalize keys on.
  const { data: doc } = await supabase
    .from("source_documents")
    .select("id, raw")
    .eq("org_id", org.id)
    .eq("kind", "agreement")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const rawTier = (doc?.raw as unknown as { tier?: string } | null)?.tier;
  if (!doc || (rawTier !== "pro" && rawTier !== "premium")) {
    return NextResponse.json({ error: "no paid agreement on file" }, { status: 400 });
  }
  const tier = rawTier; // narrowed to "pro" | "premium"
  const m = TIER_META[tier];
  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: "elements",
      mode: "subscription",
      customer_email: user.email ?? undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            product_data: { name: `Global Content ${m.label}` },
            unit_amount: m.annualPriceCents,
            recurring: { interval: "year" },
          },
        },
      ],
      metadata: { org_id: org.id, tier, source_document_id: doc.id },
      subscription_data: { metadata: { org_id: org.id, tier, source_document_id: doc.id } },
      return_url: `${origin}/onboarding/complete?session_id={CHECKOUT_SESSION_ID}`,
    });
    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (e) {
    console.error(`[stripe:checkout] ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 502 });
  }
}
