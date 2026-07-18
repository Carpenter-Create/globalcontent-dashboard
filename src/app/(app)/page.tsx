import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "@/components/onboarding-form";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";

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
  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name, status)")
    .eq("status", "active");

  const rows = (memberships ?? []).filter((m) => m.organizations);

  if (rows.length === 0) {
    return (
      <>
        <PageHeader
          title="Welcome to Global Content"
          subtitle="Set up your organization to begin."
        />
        <div className="max-w-md">
          <OnboardingForm />
        </div>
      </>
    );
  }

  const cookieOrg = (await cookies()).get("gc_active_org")?.value ?? null;
  const activeRow = rows.find((m) => m.organizations!.id === cookieOrg) ?? rows[0];
  const org = activeRow.organizations!;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Your attention queue will appear here as titles and deliveries move."
      />
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
    </>
  );
}
