import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { gcTitleStatusLabel, type TitleStatus } from "@/lib/titles";
import { LIST_PAGE, UNPAGINATED_MAX, rangeFor } from "@/lib/list-bounds";

// GC operator queue. Every title turned in by every client (draft excluded), newest
// first; titles awaiting review are surfaced at the top with a path to approve. Cross-org
// read via RLS's is_gc_staff bypass. (Internal asset viewing is a follow-on, #60.)
const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function QueueRow({
  title,
  catalogId,
  orgName,
  createdAt,
  status,
  findings,
  href,
}: {
  title: string;
  catalogId: string | null;
  orgName: string;
  createdAt: string;
  status: TitleStatus;
  findings: number;
  href: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="transition-colors hover:border-accent">
        <CardBody className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="t-body font-medium text-ink">{title}</span>
            <span className="t-body-sm text-ink-3">
              {catalogId ?? "—"} · {orgName} · added {fmt.format(new Date(createdAt))}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {findings > 0 ? (
              <span className="t-label text-ink-3">⚑ {findings}</span>
            ) : null}
            <span className="t-label text-ink-2">{gcTitleStatusLabel(status)}</span>
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}

export default async function GcQueuePage() {
  const supabase = await createClient();
  // The Queue is active work only — titles needing GC action (review, then delivery).
  // Draft (not turned in) and live/done titles don't belong here.
  const { data: titles } = await supabase
    .from("titles")
    .select("id, title, catalog_id, status, created_at, organizations(name)")
    .in("status", ["in_review", "in_delivery"])
    .order("created_at", { ascending: false })
    // BOUNDED — GC surfaces span every org, so this is where 20k lands first.
    .range(...rangeFor(LIST_PAGE));

  const list = titles ?? [];
  const needsReview = list.filter((t) => t.status === "in_review");
  const readyToDeliver = list.filter((t) => t.status === "in_delivery");

  // Findings folded into the Queue: a per-title open-findings count shown as a flag on
  // each row (the title detail lists the findings themselves). Cross-org via is_gc_staff.
  const titleIds = list.map((t) => t.id);
  const { data: findingRows } = titleIds.length
    ? await supabase
        .from("findings")
        .select("entity_id")
        .eq("entity_type", "title")
        .eq("status", "open")
        .in("entity_id", titleIds)
        .range(...rangeFor(UNPAGINATED_MAX))
    : { data: [] as { entity_id: string }[] };
  const findingsByTitle: Record<string, number> = {};
  for (const f of findingRows ?? []) {
    findingsByTitle[f.entity_id] = (findingsByTitle[f.entity_id] ?? 0) + 1;
  }

  return (
    <>
      <h1 className="t-subhead text-ink pb-1">Queue</h1>
      <p className="t-body-sm text-ink-3 pb-6">Titles that need your attention, across all clients.</p>

      <div className="flex flex-col gap-2 pb-8">
        <span className="t-label text-ink-3">Needs review</span>
        {needsReview.length === 0 ? (
          <Card>
            <CardBody>
              <p className="t-body-sm text-ink-3">Nothing awaiting review.</p>
            </CardBody>
          </Card>
        ) : (
          needsReview.map((t) => (
            <QueueRow
              key={t.id}
              title={t.title}
              catalogId={t.catalog_id}
              orgName={t.organizations?.name ?? "—"}
              createdAt={t.created_at}
              status={t.status as TitleStatus}
              findings={findingsByTitle[t.id] ?? 0}
              href={`/gc/titles/${t.id}`}
            />
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="t-label text-ink-3">Ready to deliver</span>
          <Link href="/gc/deliveries" className="t-body-sm text-accent transition-colors hover:underline">
            Delivery queue →
          </Link>
        </div>
        {readyToDeliver.length === 0 ? (
          <Card>
            <CardBody>
              <p className="t-body-sm text-ink-3">Nothing ready to deliver.</p>
            </CardBody>
          </Card>
        ) : (
          readyToDeliver.map((t) => (
            <QueueRow
              key={t.id}
              title={t.title}
              catalogId={t.catalog_id}
              orgName={t.organizations?.name ?? "—"}
              createdAt={t.created_at}
              status={t.status as TitleStatus}
              findings={findingsByTitle[t.id] ?? 0}
              href={`/gc/titles/${t.id}`}
            />
          ))
        )}
      </div>
    </>
  );
}
