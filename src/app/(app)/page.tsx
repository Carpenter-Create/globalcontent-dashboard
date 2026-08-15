import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { Card, CardBody } from "@/components/ui/card";
import { CatalogActivityHero } from "@/components/dashboard/catalog-activity-hero";
import { DASHBOARD_ATTENTION_CLEAR, dashboardAttentionSummary } from "@/lib/findings";
import { isUpcoming, isJustIn } from "@/lib/releases";
import { UNPAGINATED_MAX, rangeFor } from "@/lib/list-bounds";

const ROLE_LABELS: Record<string, string> = {
  account_owner: "Account Owner",
  accountant: "Accountant",
  legal: "Legal",
  delivery_ops: "Delivery Ops",
  viewer: "Viewer",
};

const STATUS_LABELS: Record<string, string> = {
  registered: "Registered",
  contract_review: "In contract review",
  signed: "Signed",
  onboarding: "Onboarding",
  active: "Active",
  payment_lapsed: "Payment lapsed",
  closed: "Closed",
};

const ADDED_FMT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

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
  // Client dashboard needs an org. A GC operator is not a client — the new ops seat has
  // no organization, and sending them here is how they re-enter the wizard after #114
  // already exempted the layout. Queue is the operator home; it does not need a client org.
  if (ctx.rows.length === 0 || !ctx.activeOrg) {
    redirect(ctx.isGcStaff ? "/queue" : "/onboarding");
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
    <>
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

      <div className="mt-3">
        <Card>
          <CardBody className="flex flex-col gap-2">
            <span className="t-label text-ink-3">Just in</span>
            {justIn.length === 0 ? (
              <p className="t-body-sm text-ink-3">No titles added recently.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {justIn.map((t) => (
                  <li key={t.id} className="flex items-baseline justify-between gap-4 t-body-sm">
                    <Link href={`/titles/${t.id}`} className="text-accent">
                      {t.title}
                    </Link>
                    <span className="shrink-0 text-ink-3">
                      added {ADDED_FMT.format(new Date(t.created_at))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-3">
        <Card>
          <CardBody className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <span className="t-body font-medium text-ink">
                {attentionTitles > 0
                  ? dashboardAttentionSummary(attentionTitles)
                  : DASHBOARD_ATTENTION_CLEAR}
              </span>
              <span className="t-body-sm text-ink-3">
                {attentionTitles > 0
                  ? "Review what needs attention across your catalog."
                  : "Nothing needs your attention right now."}
              </span>
            </div>
            <Link href="/catalog-health" className="shrink-0 t-body-sm text-accent">
              Catalog Health →
            </Link>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardBody className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span className="t-body font-medium text-ink">{org.name}</span>
              <span className="t-body-sm text-ink-3">
                {STATUS_LABELS[org.status] ?? org.status}
              </span>
            </div>
            <span className="rounded-[var(--radius-sm)] bg-surface-muted px-2.5 py-1 t-label text-ink-2">
              {ctx.activeRole ? (ROLE_LABELS[ctx.activeRole] ?? ctx.activeRole) : "—"}
            </span>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
