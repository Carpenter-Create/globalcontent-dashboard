import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";

// The wizard is a CLIENT surface: it exists to create an organization and put it on a plan.
// GC staff are not clients — they operate across every org and own none — so every step here
// is a dead end for them, and step 2 actively offers to create an org they must not have.
//
// The gate lives on this layout rather than on the five step pages because /onboarding sits
// OUTSIDE the (app) route group and therefore never sees that group's staff exemption. One
// gate here covers Welcome, Organization, Plan, Payment and Complete, and any step added later.
//
// Membership-shaped checks stay on the individual steps — they decide which step you resume at.
// This only answers "is this person a client at all". Same idiom and same single query as the
// (operator) layout's gate, deliberately: `is_gc_staff` is a membership predicate, not a
// capability, so any gc_role belongs on the operator side rather than in a client wizard.
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { data: staff } = await supabase
    .from("gc_staff")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (staff) redirect("/");

  return <>{children}</>;
}
