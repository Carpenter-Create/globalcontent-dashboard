import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { getOrgContext } from "@/lib/supabase/context";
import { AppShell } from "@/components/chrome/app-shell";

// Server layout for all authenticated routes: resolves the session + the user's orgs
// (RLS-scoped) and the active org, then renders the client shell around the page.
//
// Identity, memberships, GC-staff and the unread count all come from getOrgContext(),
// which is request-cached and fires its independent queries together. The page beneath
// this layout reads the same context for free.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");

  // NOTE: the "GC accounts are GC-only" enforcement is deferred until view-as-client
  // impersonation exists (#64) — until then a dual-role account keeps client-shell access
  // (with a link to the GC Queue) so the home dashboard stays reachable.

  // Client onboarding gate: a NON-GC user with no org (or an org mid-onboarding) goes to the
  // full-screen wizard. A GC operator is not a client — one with no client org still renders
  // this shell and uses the operator surfaces (Queue/Vendors now live INSIDE it, under the
  // (operator) group). We must not bounce them to onboarding, and must not redirect them to
  // /queue either — /queue now lives under this same layout, so that would loop.
  if (ctx.rows.length === 0 && !ctx.isGcStaff) redirect("/onboarding");
  // Same exemption on the mid-onboarding branch. Without it, a GC operator who also holds a
  // non-active client org is bounced to the wizard on every request — and because the wizard
  // itself has no way back for staff, that is a loop with no exit. Observed 2026-08-15 while
  // provisioning a gc_delivery_ops account.
  if (ctx.activeOrg && ctx.activeOrg.status !== "active" && !ctx.isGcStaff) {
    redirect("/onboarding");
  }

  // Sidebar collapse state persists in a cookie; read here so there's no expand→collapse flash.
  const sidebarCollapsed = (await cookies()).get("gc_sidebar_collapsed")?.value === "1";

  return (
    <AppShell
      email={ctx.user.email}
      name={ctx.user.name}
      orgs={ctx.orgs}
      activeOrgId={ctx.activeOrg?.id ?? null}
      messagesUnread={ctx.unread}
      isGcStaff={ctx.isGcStaff}
      defaultCollapsed={sidebarCollapsed}
    >
      {children}
    </AppShell>
  );
}
