import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { FindingRows } from "@/components/findings/findings-card";
import { CATALOG_HEALTH_EMPTY, CATALOG_HEALTH_SUBTITLE } from "@/lib/findings";
import { UNPAGINATED_MAX, rangeFor } from "@/lib/list-bounds";

// Catalog Health = findings/health overview (§19). A client org stays org-scoped.
// GC staff with no client org see the same findings UI across every org — my_findings
// already returns those rows because member_can('view') routes staff through gc_can,
// and titles/findings RLS already allow the queue's cross-org reads. Do not
// manufacture an org; do not send staff to /queue or the wizard.
export default async function CatalogHealthPage() {
  const supabase = await createClient();
  // Resolved once per request and shared with the layout above (React cache()).
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrg && !ctx.isGcStaff) redirect("/onboarding");

  const activeOrgId = ctx.activeOrg?.id ?? null;
  const gcWide = ctx.isGcStaff && !activeOrgId;

  const { data: allFindings } = await supabase.rpc("my_findings");
  const findings = activeOrgId
    ? (allFindings ?? []).filter((f) => f.org_id === activeOrgId)
    : (allFindings ?? []);

  const titleIds = [...new Set(findings.map((f) => f.entity_id))];
  const { data: titleRows } = titleIds.length
    ? await supabase
        .from("titles")
        .select("id, title, catalog_id, organizations(name)")
        .in("id", titleIds)
        .range(...rangeFor(UNPAGINATED_MAX))
    : { data: [] as { id: string; title: string; catalog_id: string | null; organizations: { name: string } | null }[] };
  const titleById = new Map((titleRows ?? []).map((t) => [t.id, t]));

  const byTitle: Record<string, typeof findings> = {};
  for (const f of findings) (byTitle[f.entity_id] ??= []).push(f);

  return (
    <>
      <PageHeader title="Catalog Health" subtitle={CATALOG_HEALTH_SUBTITLE} />

      {findings.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">{CATALOG_HEALTH_EMPTY}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {Object.entries(byTitle).map(([titleId, items]) => {
            const t = titleById.get(titleId);
            const orgName = t?.organizations?.name;
            return (
              <Card key={titleId}>
                <CardBody>
                  <div className="flex items-baseline justify-between gap-4 pb-2">
                    <Link
                      href={gcWide ? `/gc/titles/${titleId}` : `/titles/${titleId}/metadata`}
                      className="t-body font-medium text-accent"
                    >
                      {t?.title ?? "Title"}
                    </Link>
                    <span className="t-body-sm text-ink-3">
                      {gcWide && orgName
                        ? [t?.catalog_id, orgName].filter(Boolean).join(" · ")
                        : t?.catalog_id}
                    </span>
                  </div>
                  <FindingRows findings={items} />
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
