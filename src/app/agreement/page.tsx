import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { renderAgreement, TIER_META, TIERS, type Tier } from "@/lib/agreements";
import { Card } from "@/components/ui/card";
import { AcceptForm } from "./accept-form";

// The clickwrap surface — top-level (no dashboard shell) until the org is active.
// Pick a tier, read the conspicuous scrollable terms, accept.
export default async function AgreementPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name, status)")
    .eq("status", "active");
  const owned = (memberships ?? []).find((m) => m.role === "account_owner" && m.organizations);
  if (!owned?.organizations) redirect("/"); // no org yet → onboarding lives at /
  const org = owned.organizations;
  if (org.status === "active") redirect("/"); // already accepted

  const sp = await searchParams;
  const tier = (TIERS as string[]).includes(sp.tier ?? "") ? (sp.tier as Tier) : undefined;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <span className="t-label text-ink-3">Global Content · {org.name}</span>
        <h1 className="t-subhead text-ink">Choose your plan &amp; accept the agreement</h1>
      </div>

      {!tier ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {TIERS.map((t) => {
            const m = TIER_META[t];
            return (
              <a key={t} href={`/agreement?tier=${t}`} className="block">
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
          <div className="flex items-center justify-between">
            <span className="t-body font-medium text-ink">
              {TIER_META[tier].label} — {TIER_META[tier].priceLabel}
            </span>
            <a href="/agreement" className="t-body-sm text-ink-3 hover:text-ink-2">
              Change plan
            </a>
          </div>
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-[var(--radius)] border border-hairline bg-surface-muted p-4 t-body-sm text-ink-2">
            {renderAgreement(tier)}
          </pre>
          <AcceptForm tier={tier} needsPayment={tier !== "access"} />
        </div>
      )}
    </main>
  );
}
