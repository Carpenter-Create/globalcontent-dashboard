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
    .select("role, organizations(id, name)")
    .eq("status", "active");

  const orgs = (memberships ?? [])
    .map((m) => m.organizations)
    .filter((o): o is NonNullable<typeof o> => o !== null);

  const cookieOrg = (await cookies()).get("gc_active_org")?.value ?? null;
  const activeOrgId = orgs.find((o) => o.id === cookieOrg)?.id ?? orgs[0]?.id ?? null;

  return (
    <AppShell email={user.email ?? ""} orgs={orgs} activeOrgId={activeOrgId}>
      {children}
    </AppShell>
  );
}
