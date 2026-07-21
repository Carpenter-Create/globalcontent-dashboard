import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { FindingRows } from "@/components/findings/findings-card";
import { CATALOG_HEALTH_EMPTY, CATALOG_HEALTH_SUBTITLE } from "@/lib/findings";

// Catalog Health = the single client-side findings/health overview (§19 attention queue).
// Open validator findings for the active org, grouped by title. The Dashboard points here;
// the title-detail pages show the same findings in-context. A GC-side equivalent lands later.
export default async function CatalogHealthPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: memberships } = await supabase
    .from("memberships")
    .select("organizations(id)")
    .eq("user_id", user?.id ?? "")
    .eq("status", "active");
  const orgIds = (memberships ?? []).map((m) => m.organizations?.id).filter(Boolean) as string[];
  if (orgIds.length === 0) redirect("/onboarding");

  const cookieOrg = (await cookies()).get("gc_active_org")?.value ?? null;
  const activeOrgId = orgIds.includes(cookieOrg ?? "") ? cookieOrg! : orgIds[0];

  const { data: allFindings } = await supabase.rpc("my_findings");
  const findings = (allFindings ?? []).filter((f) => f.org_id === activeOrgId);

  const titleIds = [...new Set(findings.map((f) => f.entity_id))];
  const { data: titleRows } = titleIds.length
    ? await supabase.from("titles").select("id, title, catalog_id").in("id", titleIds)
    : { data: [] as { id: string; title: string; catalog_id: string | null }[] };
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
            return (
              <Card key={titleId}>
                <CardBody>
                  <div className="flex items-baseline justify-between gap-4 pb-2">
                    <Link
                      href={`/titles/${titleId}/metadata`}
                      className="t-body font-medium text-accent"
                    >
                      {t?.title ?? "Title"}
                    </Link>
                    <span className="t-body-sm text-ink-3">{t?.catalog_id}</span>
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
