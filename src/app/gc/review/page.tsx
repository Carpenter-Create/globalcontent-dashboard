import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { InlineNotice } from "@/components/ui/inline-notice";
import { RIGHTS_META } from "@/lib/rights";
import { describeTerritory } from "@/lib/territories";
import { ReviewControls } from "./review-controls";
import { LinkControls, type Suggestion } from "./link-controls";

// The GC review queue: every title in_review across all orgs (RLS lets GC read all
// via member_can's is_gc_staff bypass). Chain-of-title check + rights verification +
// same-work linking, with a GC-only exclusive-conflict warning (§9). The conflict
// warning is computed on read and never shown to clients.
export default async function GcReviewPage() {
  const supabase = await createClient();
  const { data: titles } = await supabase
    .from("titles")
    .select("id, title, catalog_id, work_id, created_at, organizations(name)")
    .eq("status", "in_review")
    .order("created_at", { ascending: true });

  const list = titles ?? [];
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

  // Per-title: grants (own), same-work suggestions, and computed conflicts.
  const detail = await Promise.all(
    list.map(async (t) => {
      const [{ data: grants }, { data: suggestions }, { data: conflicts }] = await Promise.all([
        supabase
          .from("rights_grants")
          .select("id, rights_type, territory_mode, territories, exclusive")
          .eq("title_id", t.id)
          .is("effective_to", null)
          .order("rights_type", { ascending: true }),
        supabase.rpc("suggest_same_work", { p_title_id: t.id }),
        supabase.rpc("same_work_conflicts", { p_title_id: t.id }),
      ]);
      return {
        grants: grants ?? [],
        suggestions: (suggestions ?? []) as Suggestion[],
        conflicts: conflicts ?? [],
      };
    }),
  );

  return (
    <>
      <h1 className="t-subhead text-ink pb-1">In review</h1>
      <p className="t-body-sm text-ink-3 pb-6">
        Confirm chain of title and rights. Link same-work submissions; exclusive conflicts are flagged.
      </p>
      {list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">Nothing awaiting review.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((t, i) => {
            const d = detail[i];
            return (
              <Card key={t.id}>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="t-body font-medium text-ink">{t.title}</span>
                    <span className="t-body-sm text-ink-3">
                      {t.catalog_id} · {t.organizations?.name ?? "—"} · added {fmt.format(new Date(t.created_at))}
                    </span>
                  </div>

                  {d.grants.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {d.grants.map((g) => (
                        <div key={g.id} className="flex items-center justify-between gap-4">
                          <span className="t-body-sm text-ink-2">
                            {RIGHTS_META[g.rights_type].label} · {g.exclusive ? "Exclusive" : "Non-exclusive"}
                          </span>
                          <span className="shrink-0 t-body-sm text-ink-3">
                            {describeTerritory(g.territory_mode, g.territories)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="t-body-sm text-ink-3">No rights declared.</span>
                  )}

                  {d.conflicts.length > 0 ? (
                    <InlineNotice tone="error">
                      Exclusive rights conflict on the same work:{" "}
                      {d.conflicts
                        .map((c) => `${RIGHTS_META[c.rights_type].label} — ${c.other_title} (${c.other_org_name})`)
                        .join("; ")}
                    </InlineNotice>
                  ) : null}

                  {t.work_id ? null : <LinkControls titleId={t.id} suggestions={d.suggestions} />}
                  <ReviewControls titleId={t.id} />
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
