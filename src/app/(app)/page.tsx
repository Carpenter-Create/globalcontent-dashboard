import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { FINDING_SEVERITY_LABEL, ATTENTION_EMPTY, ATTENTION_SUBTITLE } from "@/lib/findings";

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

// Dashboard = the §19 attention queue (findings model not built yet, so it shows the
// active org summary + an honest placeholder until findings land).
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

  // §19 attention queue — open validator findings for the active org, grouped by title.
  const { data: allFindings } = await supabase.rpc("my_findings");
  const findings = (allFindings ?? []).filter((f) => f.org_id === org.id);
  const titleIds = [...new Set(findings.map((f) => f.entity_id))];
  const { data: titleRows } = titleIds.length
    ? await supabase.from("titles").select("id, title, catalog_id").in("id", titleIds)
    : { data: [] as { id: string; title: string; catalog_id: string | null }[] };
  const titleById = new Map((titleRows ?? []).map((t) => [t.id, t]));
  const byTitle: Record<string, typeof findings> = {};
  for (const f of findings) (byTitle[f.entity_id] ??= []).push(f);

  return (
    <>
      <PageHeader title="Dashboard" subtitle={ATTENTION_SUBTITLE} />

      {findings.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">{ATTENTION_EMPTY}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {Object.entries(byTitle).map(([titleId, items]) => {
            const t = titleById.get(titleId);
            return (
              <Card key={titleId}>
                <CardBody>
                  <div className="flex items-baseline justify-between gap-4 pb-2">
                    <Link href={`/titles/${titleId}/metadata`} className="t-body font-medium text-accent">
                      {t?.title ?? "Title"}
                    </Link>
                    <span className="t-body-sm text-ink-3">{t?.catalog_id}</span>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {items.map((f) => (
                      <li key={f.id} className="flex items-center justify-between gap-3 t-body-sm">
                        <span className="text-ink-2">{f.message}</span>
                        <span className="shrink-0 t-label text-ink-3">
                          {FINDING_SEVERITY_LABEL[f.severity as "high" | "low"]}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

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
