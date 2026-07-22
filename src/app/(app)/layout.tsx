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

  // NOTE: the "GC accounts are GC-only" enforcement is deferred until view-as-client
  // impersonation exists (#64) — until then a dual-role account keeps client-shell access
  // (with a link to the GC Queue) so the home dashboard stays reachable.

  const rows = (memberships ?? []).filter((m) => m.organizations !== null);
  const cookieOrg = (await cookies()).get("gc_active_org")?.value ?? null;
  const activeRow =
    rows.find((m) => m.organizations!.id === cookieOrg) ?? rows[0] ?? null;

  // Client onboarding gate: a NON-GC user with no org (or an org mid-onboarding) goes to the
  // full-screen wizard. A GC operator is not a client — one with no client org still renders
  // this shell and uses the operator surfaces (Queue/Vendors now live INSIDE it, under the
  // (operator) group). We must not bounce them to onboarding, and must not redirect them to
  // /queue either — /queue now lives under this same layout, so that would loop.
  if (rows.length === 0 && !isGcStaff) redirect("/onboarding");
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
