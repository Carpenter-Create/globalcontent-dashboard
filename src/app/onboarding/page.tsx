import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { ONBOARDING_WELCOME, ONBOARDING_HIGHLIGHTS } from "@/lib/onboarding";
import { WizardFrame } from "./wizard-frame";

// Step 1 — Welcome. Orients the user with feature highlights before setup. Everyone
// (incl. free Access) starts here. If they already have an active org, they're onboarded.
export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("organizations(status)")
    .eq("user_id", user.id)
    .eq("status", "active");
  const orgs = (memberships ?? []).map((m) => m.organizations).filter(Boolean);
  if (orgs.some((o) => o!.status === "active")) redirect("/");

  return (
    <WizardFrame
      step={1}
      eyebrow={ONBOARDING_WELCOME.eyebrow}
      title={ONBOARDING_WELCOME.title}
      subtitle={ONBOARDING_WELCOME.subtitle}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {ONBOARDING_HIGHLIGHTS.map((h) => (
          <Card key={h.title}>
            <CardBody className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="t-body font-medium text-ink">{h.title}</span>
                {h.status === "soon" ? (
                  <span className="rounded-[var(--radius-sm)] bg-surface-muted px-2 py-0.5 t-label text-ink-3">
                    Coming soon
                  </span>
                ) : null}
              </div>
              <p className="t-body-sm text-ink-3">{h.body}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Link
        href="/onboarding/organization"
        className="self-start rounded-[var(--radius-sm)] bg-ink px-4 py-2 t-body-sm font-medium text-surface transition-opacity hover:opacity-90"
      >
        Get started
      </Link>
    </WizardFrame>
  );
}
