import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { DeliveryControls } from "./delivery-controls";
import { NewDeliveryForm } from "./new-delivery-form";
import { ExportPanel } from "./export-panel";

export default async function GcDeliveriesPage() {
  const supabase = await createClient();
  const { data: deliveries } = await supabase
    .from("deliveries")
    .select("id, territory, status, vendor_id, title_id, titles(title, catalog_id), vendors(name), organizations(name)")
    .order("created_at", { ascending: false });
  const list = deliveries ?? [];

  // group deliveries → export options (endpoint → its titles)
  const byVendor = new Map<string, { id: string; name: string; titles: Map<string, string> }>();
  for (const d of list) {
    if (!d.vendors || !d.titles) continue;
    const v = byVendor.get(d.vendor_id) ?? { id: d.vendor_id, name: d.vendors.name, titles: new Map() };
    v.titles.set(d.title_id, `${d.titles.catalog_id ?? ""} · ${d.titles.title}`);
    byVendor.set(d.vendor_id, v);
  }
  const exportVendors = [...byVendor.values()].map((v) => ({
    id: v.id, name: v.name, titles: [...v.titles].map(([id, label]) => ({ id, label })),
  }));

  const { data: titleRows } = await supabase
    .from("titles").select("id, title, catalog_id").order("title");
  const { data: vendorRows } = await supabase
    .from("vendors").select("id, name").eq("active", true).order("name");
  const { data: grantRows } = await supabase
    .from("rights_grants").select("id, title_id, rights_type, territory_mode, territories").is("effective_to", null);
  const titleOpts = (titleRows ?? []).map((t) => ({ id: t.id, label: `${t.catalog_id} · ${t.title}` }));
  const vendorOpts = (vendorRows ?? []).map((v) => ({ id: v.id, name: v.name }));
  const grantsByTitle: Record<string, { id: string; label: string }[]> = {};
  for (const g of grantRows ?? []) {
    (grantsByTitle[g.title_id] ??= []).push({
      id: g.id,
      label: `${g.rights_type} · ${g.territory_mode}${g.territories?.length ? " " + g.territories.join(",") : ""}`,
    });
  }

  return (
    <>
      <h1 className="t-subhead text-ink pb-1">Deliveries</h1>
      <p className="t-body-sm text-ink-3 pb-6">Placements across all clients. Status is set by hand.</p>

      <div className="mb-8 max-w-xl">
        <NewDeliveryForm titles={titleOpts} vendors={vendorOpts} grantsByTitle={grantsByTitle} />
      </div>

      <div className="mb-8 max-w-xl">
        <ExportPanel vendors={exportVendors} />
      </div>

      {list.length === 0 ? (
        <Card><CardBody><p className="t-body-sm text-ink-3">No deliveries yet.</p></CardBody></Card>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((d) => (
            <Card key={d.id}>
              <CardBody className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="t-body font-medium text-ink">{d.titles?.title ?? "—"}</span>
                  <span className="t-body-sm text-ink-3">
                    {d.titles?.catalog_id} · {d.vendors?.name} · {d.territory} · {d.organizations?.name}
                  </span>
                </div>
                <DeliveryControls deliveryId={d.id} status={d.status} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
