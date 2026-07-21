import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { DASHBOARD_ATTENTION_CLEAR, dashboardAttentionSummary } from "@/lib/findings";

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

// Dashboard = the client landing. Findings live in one place — Catalog Health — so the
// Dashboard only points there with a count (the de-dupe), then shows the active org summary.
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

  // No org yet → onboarding wizard (the (app) layout also guards this).
  if (rows.length === 0) redirect("/onboarding");

  const cookieOrg = (await cookies()).get("gc_active_org")?.value ?? null;
  const activeRow = rows.find((m) => m.organizations!.id === cookieOrg) ?? rows[0];
  const org = activeRow.organizations!;

  // Attention pointer — how many of the active org's titles have open findings.
  const { data: allFindings } = await supabase.rpc("my_findings");
  const attentionTitles = new Set(
    (allFindings ?? []).filter((f) => f.org_id === org.id).map((f) => f.entity_id),
  ).size;

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`Welcome back to ${org.name}.`} />

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
          <Link
            href="/catalog-health"
            className="shrink-0 t-body-sm text-accent"
          >
            Catalog Health →
          </Link>
        </CardBody>
      </Card>

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
