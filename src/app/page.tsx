import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { OnboardingForm } from "@/components/onboarding-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { signOut } from "./actions";

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

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS-scoped: this user sees ONLY their own org memberships (proves tenant isolation
  // end-to-end from the app). member_can(view) gates both memberships and organizations.
  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, status, organizations(name, status)")
    .eq("status", "active");

  const orgs = (memberships ?? []).filter((m) => m.organizations);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="t-label text-ink-3">Global Content</span>
          <h1 className="t-subhead text-ink">Your organizations</h1>
          <p className="t-body-sm text-ink-3">{user.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <form action={signOut}>
            <Button variant="secondary" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      {orgs.length === 0 ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="t-lead text-ink">Create your organization</h2>
            <p className="t-body-sm text-body">
              This is the account that signs the licensing agreement and owns every title,
              asset, and statement.
            </p>
          </div>
          <OnboardingForm />
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          {orgs.map((m, i) => {
            const org = m.organizations!;
            return (
              <Card key={i} className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <span className="t-body font-medium text-ink">{org.name}</span>
                  <span className="t-body-sm text-ink-3">
                    {STATUS_LABELS[org.status] ?? org.status}
                  </span>
                </div>
                <span className="rounded-[var(--radius-sm)] bg-surface-muted px-2.5 py-1 t-label text-ink-2">
                  {ROLE_LABELS[m.role] ?? m.role}
                </span>
              </Card>
            );
          })}
        </section>
      )}
    </main>
  );
}
