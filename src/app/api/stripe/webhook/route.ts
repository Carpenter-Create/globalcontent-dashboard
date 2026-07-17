import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { stripe } from "@/lib/stripe/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe webhook. Verifies the signature, then on a completed checkout writes the subscription +
// contract_terms + flips the org to active via finalize_paid_signup (service_role, idempotent).
// effective_from = the Stripe event timestamp, never now() (§5).
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: "missing signature or secret" }, { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    console.error(`[stripe:webhook] invalid signature: ${e instanceof Error ? e.message : e}`);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const md = s.metadata ?? {};
    const customerId = typeof s.customer === "string" ? s.customer : (s.customer?.id ?? null);
    const subId = typeof s.subscription === "string" ? s.subscription : (s.subscription?.id ?? null);

    if (md.org_id && md.tier && md.source_document_id && customerId && subId) {
      const admin = createAdminClient();
      const { error } = await admin.rpc("finalize_paid_signup", {
        p_org: md.org_id,
        p_tier: md.tier as "pro" | "premium",
        p_stripe_customer: customerId,
        p_stripe_subscription: subId,
        p_price_cents: s.amount_total ?? 0,
        p_effective_from: new Date(event.created * 1000).toISOString(),
        p_source_document_id: md.source_document_id,
      });
      if (error) {
        console.error(`[stripe:webhook] finalize_paid_signup failed: ${error.message}`);
        return NextResponse.json({ error: "finalize failed" }, { status: 500 });
      }
    } else {
      console.error("[stripe:webhook] checkout.session.completed missing required metadata");
    }
  }

  return NextResponse.json({ received: true });
}
