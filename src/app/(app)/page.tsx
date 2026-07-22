import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { StatTile } from "@/components/dashboard/stat-tile";
import { DASHBOARD_ATTENTION_CLEAR, dashboardAttentionSummary } from "@/lib/findings";
import {
  isUpcoming,
  isNewRelease,
  isJustIn,
  formatReleaseDate,
  RELEASE_NEW_WINDOW_DAYS,
} from "@/lib/releases";

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
// dashboard-tiles). Operational tiles read live data; Revenue is a seam until the
// statements module lands. Findings stay owned by Catalog Health — the Dashboard
// only points there.
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name, status)")
    .eq("user_id", user?.id ?? "")
    .eq("status", "active");

  const rows = (memberships ?? []).filter((m) => m.organizations);
  if (rows.length === 0) redirect("/onboarding");

  const cookieOrg = (await cookies()).get("gc_active_org")?.value ?? null;
  const activeRow = rows.find((m) => m.organizations!.id === cookieOrg) ?? rows[0];
  const org = activeRow.organizations!;

  // Portfolio reads for the active org (RLS-scoped; counts computed here per spec).
  const { data: titleRows } = await supabase
    .from("titles")
    .select("id, title, catalog_id, status, release_date, created_at")
    .eq("org_id", org.id);
  const titles = titleRows ?? [];

  const now = new Date();
  const liveCount = titles.filter((t) => t.status === "live").length;
  const inReviewCount = titles.filter((t) => t.status === "in_review").length;
  const upcoming = titles.filter((t) => isUpcoming(t.release_date, now));
  const newReleases = titles.filter((t) => isNewRelease(t.release_date, now));
  const nextUpcoming = upcoming
    .map((t) => t.release_date!)
    .sort()
    .at(0);
  const justIn = titles
    .filter((t) => isJustIn(t.created_at, now))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 5);

  // Attention pointer — how many titles have open findings (findings live in Catalog Health).
  const { data: allFindings } = await supabase.rpc("my_findings");
  const attentionTitles = new Set(
    (allFindings ?? []).filter((f) => f.org_id === org.id).map((f) => f.entity_id),
  ).size;

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Welcome back to ${org.name}.`} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Catalog"
          value={titles.length}
          meta={`${liveCount} live · ${inReviewCount} in review`}
          href="/titles"
        />
        <StatTile label="Revenue" value="—" meta="Arrives with statements" tone="muted" />
        <StatTile
          label="Upcoming"
          value={upcoming.length}
          meta={nextUpcoming ? `Next ${formatReleaseDate(nextUpcoming)}` : "None scheduled"}
        />
        <StatTile
          label="New releases"
          value={newReleases.length}
          meta={`Last ${RELEASE_NEW_WINDOW_DAYS} days`}
        />
      </div>

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
                      {t.catalog_id ? `${t.catalog_id} · ` : ""}
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
              {ROLE_LABELS[activeRow.role] ?? activeRow.role}
            </span>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
