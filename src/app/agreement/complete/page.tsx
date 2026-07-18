import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/server";
import { CompletePoller } from "./complete-poller";

// Stripe return_url (on our domain). Confirms the session completed, then the poller waits for
// the webhook to finalize before entering the app. If the session isn't complete, back to pay.
export default async function CompletePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { session_id } = await searchParams;
  if (!session_id) redirect("/agreement/pay");

  const session = await stripe.checkout.sessions.retrieve(session_id);
  if (session.status !== "complete") redirect("/agreement/pay");

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-6 py-16">
      <h1 className="t-subhead text-ink">Thank you</h1>
      <CompletePoller />
    </main>
  );
}
