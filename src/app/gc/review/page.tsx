import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { ReviewControls } from "./review-controls";

// The GC review queue: every title in_review across all orgs (RLS lets GC read
// all via member_can's is_gc_staff bypass). Chain-of-title check only (§11).
export default async function GcReviewPage() {
  const supabase = await createClient();
  const { data: titles } = await supabase
    .from("titles")
    .select("id, title, created_at, organizations(name)")
    .eq("status", "in_review")
    .order("created_at", { ascending: true });

  const list = titles ?? [];
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

  return (
    <>
      <h1 className="t-subhead text-ink pb-1">In review</h1>
      <p className="t-body-sm text-ink-3 pb-6">
        Chain-of-title check only — confirm the client owns or controls the film.
      </p>
      {list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">Nothing awaiting review.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((t) => (
            <Card key={t.id}>
              <CardBody className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="t-body font-medium text-ink">{t.title}</span>
                    <span className="t-body-sm text-ink-3">
                      {t.organizations?.name ?? "—"} · added {fmt.format(new Date(t.created_at))}
                    </span>
                  </div>
                </div>
                <ReviewControls titleId={t.id} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
