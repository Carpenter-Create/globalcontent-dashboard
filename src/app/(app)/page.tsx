import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import {
  DashboardDoNext,
  DashboardHomePillLink,
  DashboardJustIn,
  DashboardOrgIdentity,
  DashboardSnapshot,
} from "@/components/dashboard/dashboard-home";
import {
  DASHBOARD_HOME,
  clientHomeSnapshot,
  dashboardCatalogValue,
} from "@/lib/dashboard-home";
import { UNPAGINATED_MAX, rangeFor } from "@/lib/list-bounds";
import { GcClientsDirectory } from "@/app/(app)/(operator)/gc/clients/clients-directory";

// Client `/` is the organization-scoped portfolio: identity, three live numbers,
// what to do next, and what just arrived. No chart, no revenue seam, no upcoming
// or platform-placement row. Findings stay owned by Catalog Health — we only
// point there. Staff without a client org still see the GC-wide clients roster.
export default async function DashboardPage() {
  const supabase = await createClient();
  // Resolved once per request and shared with the layout above (React cache()).
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  // Client dashboard needs an org. A GC operator is not a client and must not be
  // given a manufactured one. Staff without a client org stay on `/` and see the
  // existing GC-wide clients roster. Queue stays the focused work queue at /queue.
  // Non-staff without an org still go to the client wizard.
  if (ctx.rows.length === 0 || !ctx.activeOrg) {
    if (!ctx.isGcStaff) redirect("/onboarding");
    return GcClientsDirectory();
  }
  const org = ctx.activeOrg;

  // Portfolio reads for the active org (RLS-scoped; counts computed here).
  // BOUNDED. These feed portfolio counts, so a cap makes the numbers a floor rather than a
  // total once a catalog exceeds it. Phase 4 of the catalog-at-scale spec replaces the
  // count-in-JS with a DB aggregate, which is both correct and cheaper.
  const { data: titleRows } = await supabase
    .from("titles")
    .select("id, title, status, created_at")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .range(...rangeFor(UNPAGINATED_MAX));
  const titles = titleRows ?? [];

  const { data: allFindings } = await supabase.rpc("my_findings");
  const snapshot = clientHomeSnapshot({
    titles,
    findings: allFindings ?? [],
    orgId: org.id,
    now: new Date(),
    bound: UNPAGINATED_MAX,
  });

  return (
    <div className="dashboard-home flex flex-col gap-[var(--space-10)]" data-dashboard-home="">
      <div className="flex flex-col gap-[var(--space-8)]">
        <div className="flex flex-col gap-[var(--space-6)] sm:flex-row sm:items-end sm:justify-between">
          <DashboardOrgIdentity name={org.name} status={org.status} role={ctx.activeRole} />
          <DashboardHomePillLink href="/catalog-health">
            {DASHBOARD_HOME.catalogHealthCta}
          </DashboardHomePillLink>
        </div>

        <DashboardSnapshot
          catalog={dashboardCatalogValue(snapshot.catalog, snapshot.catalogIsPartial)}
          needsAttention={snapshot.needsAttention}
          live={snapshot.live}
        />
      </div>

      <div className="grid grid-cols-1 gap-[var(--space-10)] lg:grid-cols-2 lg:items-start">
        <DashboardDoNext attentionTitleCount={snapshot.needsAttention} drafts={snapshot.drafts} />
        <DashboardJustIn titles={snapshot.justIn} />
      </div>
    </div>
  );
}
