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

  // GC staff get full cross-org access + a link into the GC operator area, and are never
  // treated as clients (a pure GC operator with no client org goes to /gc, not onboarding).
  const { data: gcStaff } = await supabase
    .from("gc_staff")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const isGcStaff = !!gcStaff;

  const rows = (memberships ?? []).filter((m) => m.organizations !== null);
  const cookieOrg = (await cookies()).get("gc_active_org")?.value ?? null;
  const activeRow =
    rows.find((m) => m.organizations!.id === cookieOrg) ?? rows[0] ?? null;

  // Everyone finishes onboarding before the dashboard: no org, or an org that hasn't
  // completed agreement/payment (registered / awaiting_payment), goes to the wizard
  // (full-screen, outside this shell). The wizard resumes at the right step from status.
  if (rows.length === 0) redirect(isGcStaff ? "/gc" : "/onboarding");
  if (activeRow && activeRow.organizations!.status !== "active") {
    redirect("/onboarding");
  }

  const orgs = rows.map((m) => ({ id: m.organizations!.id, name: m.organizations!.name }));
  const activeOrgId = activeRow?.organizations!.id ?? null;

  // Unread notification count for the nav badge (§20 in-app push).
  const { data: unread } = await supabase.rpc("my_unread_count");

  return (
    <AppShell
      email={user.email ?? ""}
      orgs={orgs}
      activeOrgId={activeOrgId}
      messagesUnread={unread ?? 0}
      isGcStaff={isGcStaff}
    >
      {children}
    </AppShell>
  );
}
