import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { renderAgreement, TIER_META, TIERS, type Tier } from "@/lib/agreements";
import { Card } from "@/components/ui/card";
import { AcceptForm } from "@/app/agreement/accept-form";
import { WizardFrame } from "../wizard-frame";

// Step 3 — Choose plan + accept agreement. Tier cards, then the conspicuous scrollable
// terms + clickwrap (AcceptForm → accept_terms: free→active, paid→awaiting_payment).
export default async function PlanStep({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string }>;
}) {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name, status)")
    .eq("user_id", user.id)
    .eq("status", "active");
  const owned = (memberships ?? []).find((m) => m.role === "account_owner" && m.organizations);
  if (!owned?.organizations) redirect("/onboarding/organization");
  const org = owned.organizations;
  if (org.status === "active") redirect("/");
  if (org.status === "awaiting_payment") redirect("/onboarding/payment");

  const sp = await searchParams;
  const tier = (TIERS as string[]).includes(sp.tier ?? "") ? (sp.tier as Tier) : undefined;

  return (
    <WizardFrame
      step={3}
      eyebrow={`Global Content · ${org.name}`}
      title="Choose your plan"
      subtitle={tier ? undefined : "You can change tier later; a downgrade is free."}
      back={tier ? "/onboarding/plan" : "/onboarding/organization"}
    >
      {!tier ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {TIERS.map((t) => {
            const m = TIER_META[t];
            return (
              <a key={t} href={`/onboarding/plan?tier=${t}`} className="block">
                <Card className="flex h-full flex-col gap-1 p-4 transition-colors hover:border-accent">
                  <span className="t-body font-medium text-ink">{m.label}</span>
                  <span className="t-data text-ink">{m.priceLabel}</span>
                  <span className="t-body-sm text-ink-3">{m.blurb}</span>
                </Card>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <span className="t-body font-medium text-ink">
              {TIER_META[tier].label} — {TIER_META[tier].priceLabel} · {TIER_META[tier].termMonths}-month term
            </span>
            <a href="/onboarding/plan" className="t-body-sm text-ink-3 hover:text-ink-2">
              Change plan
            </a>
          </div>
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius)] border border-hairline bg-surface-muted p-4 t-body-sm text-ink-2">
            {renderAgreement(tier)}
          </pre>
          <AcceptForm tier={tier} needsPayment={tier !== "access"} />
        </div>
      )}
    </WizardFrame>
  );
}
