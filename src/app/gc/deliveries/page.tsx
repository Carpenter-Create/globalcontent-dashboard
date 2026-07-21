import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { DeliveryControls } from "./delivery-controls";
import { NewDeliveryForm } from "./new-delivery-form";
import { ExportPanel } from "./export-panel";
import { PortalLinks, type Master, type PortalLink, type PortalAccessEvent } from "./portal-links";

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

  // Only APPROVED titles are deliverable (assembly line: review → approved → deliver).
  // A title reaches in_delivery only after GC approves it; live = already on ≥1 platform.
  const { data: titleRows } = await supabase
    .from("titles").select("id, title, catalog_id").in("status", ["in_delivery", "live"]).order("title");
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

  // Portal-link management (Task 10): master assets to link, this delivery's
  // links, and the access-event log for those links. GC RLS (is_gc_staff) permits
  // these SELECTs across all orgs — see 20260720000100_portal_gate.sql.
  const { data: masterRows } = await supabase
    .from("assets")
    .select("id, title_id, original_filename, bytes")
    .eq("kind", "master");
  const mastersByTitle: Record<string, Master[]> = {};
  for (const a of masterRows ?? []) {
    (mastersByTitle[a.title_id] ??= []).push({
      id: a.id, original_filename: a.original_filename, bytes: a.bytes,
    });
  }

  const { data: linkRows } = await supabase
    .from("portal_links")
    .select("id, delivery_id, asset_id, expires_at, revoked_at, created_at")
    .eq("purpose", "master_download") // deliveries queue shows only delivery-scoped master links
    .order("created_at", { ascending: false });
  const linksByDelivery: Record<string, PortalLink[]> = {};
  for (const l of linkRows ?? []) {
    if (!l.delivery_id || !l.asset_id) continue; // master_download rows always set both
    (linksByDelivery[l.delivery_id] ??= []).push({
      id: l.id, asset_id: l.asset_id, expires_at: l.expires_at, revoked_at: l.revoked_at,
    });
  }

  const { data: eventRows } = await supabase
    .from("portal_access_events")
    .select("link_id, event_type, email, company, occurred_at")
    .order("occurred_at", { ascending: false });
  const eventsByLink: Record<string, PortalAccessEvent[]> = {};
  for (const e of eventRows ?? []) {
    (eventsByLink[e.link_id] ??= []).push(e);
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
          {list.map((d) => {
            const links = linksByDelivery[d.id] ?? [];
            const events = links.flatMap((l) => eventsByLink[l.id] ?? []);
            return (
              <Card key={d.id}>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="t-body font-medium text-ink">{d.titles?.title ?? "—"}</span>
                      <span className="t-body-sm text-ink-3">
                        {d.titles?.catalog_id} · {d.vendors?.name} · {d.territory} · {d.organizations?.name}
                      </span>
                    </div>
                    <DeliveryControls deliveryId={d.id} status={d.status} />
                  </div>
                  <PortalLinks
                    deliveryId={d.id}
                    masters={mastersByTitle[d.title_id] ?? []}
                    links={links}
                    events={events}
                  />
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
