import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { FINDING_SEVERITY_LABEL } from "@/lib/findings";

// GC-side §19 surfacing: open findings across ALL clients (RLS grants is_gc_staff all orgs).
export default async function GcFindingsPage() {
  const supabase = await createClient();
  const { data: findings } = await supabase
    .from("findings")
    .select("id, org_id, entity_id, severity, message, created_at, organizations(name)")
    .eq("status", "open")
    .order("severity", { ascending: true })
    .order("created_at", { ascending: true });
  const list = findings ?? [];

  const titleIds = [...new Set(list.map((f) => f.entity_id))];
  const { data: titleRows } = titleIds.length
    ? await supabase.from("titles").select("id, title, catalog_id").in("id", titleIds)
    : { data: [] as { id: string; title: string; catalog_id: string | null }[] };
  const titleById = new Map((titleRows ?? []).map((t) => [t.id, t]));

  return (
    <>
      <h1 className="t-subhead text-ink pb-1">Findings</h1>
      <p className="t-body-sm text-ink-3 pb-6">Open findings across all clients.</p>

      {list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">No open findings.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((f) => {
            const t = titleById.get(f.entity_id);
            return (
              <Card key={f.id}>
                <CardBody className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="t-body font-medium text-ink">{t?.title ?? "Title"}</span>
                    <span className="t-body-sm text-ink-3">
                      {f.organizations?.name} · {t?.catalog_id} · {f.message}
                    </span>
                  </div>
                  <span className="shrink-0 t-label text-ink-2">
                    {FINDING_SEVERITY_LABEL[f.severity as "high" | "low"]}
                  </span>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
