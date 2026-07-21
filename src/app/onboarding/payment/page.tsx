import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PaymentCheckout } from "@/app/agreement/pay/payment-checkout";
import { WizardFrame } from "../wizard-frame";

// Step 4 — Payment (paid tiers only). On-domain embedded Payment Element. Only reachable for
// an awaiting_payment org; Access never lands here (accept_terms activated it directly).
export default async function PaymentStep() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name, status)")
    .eq("user_id", user.id)
    .eq("status", "active");
  const owned = (memberships ?? []).find((m) => m.role === "account_owner" && m.organizations);
  if (!owned?.organizations) redirect("/onboarding/organization");
  const org = owned.organizations;
  if (org.status === "active") redirect("/");
  if (org.status !== "awaiting_payment") redirect("/onboarding/plan"); // registered → pick a plan first

  return (
    <WizardFrame
      step={4}
      eyebrow={`Global Content · ${org.name}`}
      title="Complete your subscription"
      back="/onboarding/plan"
    >
      <div className="max-w-lg">
        <PaymentCheckout />
      </div>
    </WizardFrame>
  );
}
