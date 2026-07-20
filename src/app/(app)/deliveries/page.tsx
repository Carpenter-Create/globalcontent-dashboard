import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending", delivered: "Delivered", live: "Live", rejected: "Rejected", taken_down: "Taken down",
};

export default async function DeliveriesPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_deliveries");
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Deliveries" subtitle="Where your titles are placed and their status." />
      {rows.length === 0 ? (
        <Card><CardBody><p className="t-body-sm text-ink-3">No deliveries yet.</p></CardBody></Card>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((d) => (
            <Card key={d.delivery_id}>
              <CardBody className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="t-body font-medium text-ink">{d.title}</span>
                  <span className="t-body-sm text-ink-3">{d.vendor_name} · {d.territory}</span>
                </div>
                <span className="shrink-0 t-body-sm text-ink-2">{STATUS_LABELS[d.status] ?? d.status}</span>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
