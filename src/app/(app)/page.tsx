import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { CatalogActivityHero } from "@/components/dashboard/catalog-activity-hero";
import {
  DashboardAttention,
  DashboardJustIn,
  DashboardOrgIdentity,
} from "@/components/dashboard/dashboard-home";
import { isUpcoming, isJustIn } from "@/lib/releases";
import { UNPAGINATED_MAX, rangeFor } from "@/lib/list-bounds";
import { GcClientsDirectory } from "@/app/(app)/(operator)/gc/clients/clients-directory";

// Dashboard = the client's portfolio snapshot (spec: 2026-07-21 release-dates-and-
// dashboard-tiles; hero: 2026-07-22 charted-hero). The charcoal hero carries the
// one data-viz — cumulative catalog size over time, a REAL series derived from
// title.created_at — plus the snapshot stats row. Revenue stays a seam until the
// statements module lands; findings stay owned by Catalog Health (we only point there).
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

  // Portfolio reads for the active org (RLS-scoped; counts computed here per spec).
  // BOUNDED. These feed portfolio counts, so a cap makes the numbers a floor rather than a
  // total once a catalog exceeds it. Phase 4 of the catalog-at-scale spec replaces the
  // count-in-JS with a DB aggregate, which is both correct and cheaper.
  const { data: titleRows } = await supabase
    .from("titles")
    .select("id, title, catalog_id, status, release_date, created_at")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false })
    .range(...rangeFor(UNPAGINATED_MAX));
  const titles = titleRows ?? [];
  const countsArePartial = titles.length >= UNPAGINATED_MAX;

  const now = new Date();
  const liveCount = titles.filter((t) => t.status === "live").length;
  const upcoming = titles.filter((t) => isUpcoming(t.release_date, now));
  const justIn = titles
    .filter((t) => isJustIn(t.created_at, now))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 5);

  // Real, derived series for the hero chart: title creation timestamps, sorted ascending.
  const createdAt = titles
    .map((t) => new Date(t.created_at).getTime())
    .sort((a, b) => a - b);

  // Attention pointer — how many titles have open findings (findings live in Catalog Health).
  const { data: allFindings } = await supabase.rpc("my_findings");
  const attentionTitles = new Set(
    (allFindings ?? []).filter((f) => f.org_id === org.id).map((f) => f.entity_id),
  ).size;

  return (
    <div className="dashboard-home flex flex-col gap-[var(--space-10)]">
      <h1 className="sr-only">Dashboard — {org.name}</h1>

      <CatalogActivityHero
        createdAt={createdAt}
        nowMs={now.getTime()}
        stats={{
          catalog: countsArePartial ? `${titles.length}+` : titles.length,
          upcoming: upcoming.length,
          live: liveCount,
          revenue: "—",
        }}
      />

      <DashboardJustIn titles={justIn} />

      <DashboardAttention titleCount={attentionTitles} />

      <DashboardOrgIdentity name={org.name} status={org.status} role={ctx.activeRole} />
    </div>
  );
}
