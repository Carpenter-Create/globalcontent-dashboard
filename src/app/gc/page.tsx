import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { TITLE_STATUS_LABELS, type TitleStatus } from "@/lib/titles";

// GC operator queue — the landing surface. Every title turned in by every client
// (draft excluded), newest first; titles awaiting review are surfaced at the top with
// a path to approve. Cross-org read via RLS's is_gc_staff bypass. (Internal asset
// viewing — screener playback + all-asset view/download for GC — is a follow-on.)
const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function QueueRow({
  title,
  catalogId,
  orgName,
  createdAt,
  status,
  href,
}: {
  title: string;
  catalogId: string | null;
  orgName: string;
  createdAt: string;
  status: TitleStatus;
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
          <span className="shrink-0 t-label text-ink-2">{TITLE_STATUS_LABELS[status]}</span>
        </CardBody>
      </Card>
    </Link>
  );
}

export default async function GcQueuePage() {
  const supabase = await createClient();
  const { data: titles } = await supabase
    .from("titles")
    .select("id, title, catalog_id, status, created_at, organizations(name)")
    .neq("status", "draft")
    .order("created_at", { ascending: false });

  const list = titles ?? [];
  const needsReview = list.filter((t) => t.status === "in_review");
  const others = list.filter((t) => t.status !== "in_review");

  return (
    <>
      <h1 className="t-subhead text-ink pb-1">Queue</h1>
      <p className="t-body-sm text-ink-3 pb-6">Every title turned in, across all clients.</p>

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
              href="/gc/review"
            />
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="t-label text-ink-3">All titles</span>
        {others.length === 0 ? (
          <Card>
            <CardBody>
              <p className="t-body-sm text-ink-3">No other titles yet.</p>
            </CardBody>
          </Card>
        ) : (
          others.map((t) => (
            <QueueRow
              key={t.id}
              title={t.title}
              catalogId={t.catalog_id}
              orgName={t.organizations?.name ?? "—"}
              createdAt={t.created_at}
              status={t.status as TitleStatus}
              href="/gc/deliveries"
            />
          ))
        )}
      </div>
    </>
  );
}
