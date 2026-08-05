import { redirect } from "next/navigation";

import { getAuthUser } from "@/lib/supabase/auth";
import { stripe } from "@/lib/stripe/server";
import { CompletePoller } from "@/app/agreement/complete/complete-poller";
import { WizardFrame } from "../wizard-frame";

// Step 5 — Completion. Stripe return_url (on our domain). Confirms the session completed, then
// the poller waits for the webhook's finalize_paid_signup to flip the org active before the dashboard.
export default async function CompleteStep({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { session_id } = await searchParams;
  if (!session_id) redirect("/onboarding/payment");

  const session = await stripe.checkout.sessions.retrieve(session_id);
  if (session.status !== "complete") redirect("/onboarding/payment");

  return (
    <WizardFrame step={5} eyebrow="Global Content" title="You're all set">
      <CompletePoller />
    </WizardFrame>
  );
}
