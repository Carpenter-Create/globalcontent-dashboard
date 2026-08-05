import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { OnboardingForm } from "@/components/onboarding-form";
import { WizardFrame } from "../wizard-frame";

// Step 2 — Organization. Creates the org (status `registered`) via create_org_and_membership,
// then createOrg redirects forward to the plan step. Resume forward if an org already exists.
export default async function OrganizationStep() {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, status)")
    .eq("user_id", user.id)
    .eq("status", "active");
  const owned = (memberships ?? []).find((m) => m.role === "account_owner" && m.organizations);
  if (owned?.organizations) {
    const status = owned.organizations.status;
    if (status === "active") redirect("/");
    if (status === "awaiting_payment") redirect("/onboarding/payment");
    redirect("/onboarding/plan"); // registered → pick a plan
  }

  return (
    <WizardFrame
      step={2}
      eyebrow="Global Content"
      title="Name your organization"
      subtitle="This is the account that holds your titles, rights, and deliveries."
      back="/onboarding"
    >
      <div className="max-w-md">
        <OnboardingForm />
      </div>
    </WizardFrame>
  );
}
