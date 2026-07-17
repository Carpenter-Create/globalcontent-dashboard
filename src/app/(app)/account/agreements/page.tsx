import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { TIER_META, type Tier } from "@/lib/agreements";

// §5 "show your work": every agreement the org has accepted, kept exactly as shown
// (the immutable source document), viewable + downloadable forever.
export default async function AgreementsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name)")
    .eq("status", "active");
  const rows = (memberships ?? []).filter((m) => m.organizations);
  const cookieOrg = (await cookies()).get("gc_active_org")?.value ?? null;
  const activeOrg =
    rows.find((m) => m.organizations!.id === cookieOrg)?.organizations ??
    rows[0]?.organizations ??
    null;
  if (!activeOrg) redirect("/");

  // RLS-scoped to the org; the rendered text lives on the linked source document.
  const { data: assents } = await supabase
    .from("contract_assents")
    .select("id, terms_version, agreed_at, source_document_id, source_documents(raw)")
    .eq("org_id", activeOrg.id)
    .order("agreed_at", { ascending: false });

  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
  const list = assents ?? [];

  return (
    <>
      <PageHeader
        title="Agreements"
        subtitle={`Every agreement ${activeOrg.name} has accepted — kept exactly as shown, downloadable anytime.`}
      />
      {list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">No agreements accepted yet.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((a) => {
            const raw = a.source_documents?.raw as unknown as
              | { tier?: string; text?: string }
              | null;
            const tier = raw?.tier as Tier | undefined;
            const label = tier ? `${TIER_META[tier].label} agreement` : "Agreement";
            return (
              <Card key={a.id}>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="t-body font-medium text-ink">{label}</span>
                      <span className="t-body-sm text-ink-3">
                        Version {a.terms_version} · accepted {fmt.format(new Date(a.agreed_at))}
                      </span>
                    </div>
                    <a
                      href={`/api/agreements/${a.source_document_id}`}
                      download
                      className="shrink-0 t-body-sm text-accent"
                    >
                      Download
                    </a>
                  </div>
                  {raw?.text ? (
                    <details className="rounded-[var(--radius-sm)] border border-hairline bg-surface-muted">
                      <summary className="cursor-pointer px-3 py-2 t-body-sm text-ink-2">
                        View agreement text
                      </summary>
                      <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap px-3 pb-3 t-body-sm text-ink-2">
                        {raw.text}
                      </pre>
                    </details>
                  ) : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
