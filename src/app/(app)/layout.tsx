import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/chrome/app-shell";

// Server layout for all authenticated routes: resolves the session + the user's orgs
// (RLS-scoped) and the active org, then renders the client shell around the page.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
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

  const rows = (memberships ?? []).filter((m) => m.organizations !== null);
  const cookieOrg = (await cookies()).get("gc_active_org")?.value ?? null;
  const activeRow =
    rows.find((m) => m.organizations!.id === cookieOrg) ?? rows[0] ?? null;

  // An org that hasn't completed the agreement (registered / awaiting_payment) can't use
  // the dashboard yet — send it to the clickwrap surface (outside this shell). No org at
  // all → fall through so `/` can render onboarding.
  if (activeRow && activeRow.organizations!.status !== "active") {
    redirect("/agreement");
  }

  const orgs = rows.map((m) => ({ id: m.organizations!.id, name: m.organizations!.name }));
  const activeOrgId = activeRow?.organizations!.id ?? null;

  return (
    <AppShell email={user.email ?? ""} orgs={orgs} activeOrgId={activeOrgId}>
      {children}
    </AppShell>
  );
}
