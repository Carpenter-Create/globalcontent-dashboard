import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { Card, CardBody } from "@/components/ui/card";
import { InlineNotice } from "@/components/ui/inline-notice";
import { RIGHTS_META } from "@/lib/rights";
import { describeTerritory } from "@/lib/territories";
import { METADATA_FIELDS } from "@/lib/metadata";
import { FindingsCard } from "@/components/findings/findings-card";
import type { ReleaseType } from "@/lib/releases";
import { ReleaseDateControl } from "./release-date-control";
import { gcTitleStatusLabel, DELIVERY_STATUS_ROW_LABELS, type TitleStatus } from "@/lib/titles";
import { ReviewControls } from "@/app/(app)/(operator)/gc/review/review-controls";
import { LinkControls, type Suggestion } from "@/app/(app)/(operator)/gc/review/link-controls";
import { ScreenerPanel, type ScreenerLink, type ScreenerViewer } from "@/app/(app)/(operator)/gc/review/screener-panel";
import { GcAssets, type GcAsset } from "./gc-assets";
import { BuyerLinks, type BuyerLink, type VendorOption } from "./buyer-links";
import { UNPAGINATED_MAX, DETAIL_LIST, rangeFor } from "@/lib/list-bounds";
import { isMasterLicensed, type DeliveryForLicenceCheck } from "@/lib/master-licence";

// The GC per-title detail = the internal review page (folds in /gc/review). Review actions
// (approve/reject, same-work linking) show only while in_review; screener panel + metadata +
// rights + findings always. Cross-org read via RLS's is_gc_staff bypass. Internal asset viewer
// + delivery-from-here land in later phases of the GC-operator pass.
function fmtMeta(v: unknown): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

export default async function GcTitleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const { data: t } = await supabase
    .from("titles")
    .select("id, title, catalog_id, status, work_id, created_at, release_type, original_release_date, release_date, organizations(name)")
    .eq("id", id)
    .maybeSingle();
  if (!t) notFound();

  const [
    { data: grants },
    { data: suggestions },
    { data: conflicts },
    { data: screenerLinks },
    { data: metaRow },
    { data: findings },
    { data: assets },
    { data: deliveries },
    { data: activeVendors },
  ] = await Promise.all([
      supabase
        .from("rights_grants")
        .select("id, rights_type, territory_mode, territories, exclusive")
        .eq("title_id", id)
        .is("effective_to", null)
        .order("rights_type", { ascending: true }),
      supabase.rpc("suggest_same_work", { p_title_id: id }),
      supabase.rpc("same_work_conflicts", { p_title_id: id }),
      supabase
        .from("portal_links")
        .select("id, title_id, expires_at, revoked_at, created_at, share_token, recipient_name, vendor_id, vendors(name)")
        .eq("purpose", "screener_view")
        .eq("title_id", id)
        .order("created_at", { ascending: false })
        // BOUNDED — a title-detail child collection (fix round 1, item 5): this query lost its
        // bound when it was widened to also feed BuyerLinks; a real title's screener_view rows
        // are naturally small in number, but "naturally small today" is exactly the assumption
        // list-bounds.ts exists to stop anyone relying on silently.
        .range(...rangeFor(DETAIL_LIST)),
      supabase.from("title_metadata").select("data").eq("title_id", id).maybeSingle(),
      supabase
        .from("findings")
        .select("id, message, severity")
        .eq("entity_type", "title")
        .eq("entity_id", id)
        .eq("status", "open"),
      supabase
        .from("assets")
        .select("id, kind, original_filename, bytes")
        .eq("title_id", id)
        .order("kind"),
      // Also carries vendor_id + the joined grant fields now (fix round 1, item 3): the same
      // rows that already power the read-only Deliveries card below are exactly what
      // isMasterLicensed needs to compute, per vendor, "would attaching this one release the
      // master right now" — one query, two views, same shape master-download/route.ts already
      // reads for the identical check. BOUNDED like that route's own read of this table.
      supabase
        .from("deliveries")
        .select("id, territory, status, vendor_id, vendors(name), rights_grants(effective_to, window_start, window_end, territory_mode, territories)")
        .eq("title_id", id)
        .order("created_at", { ascending: false })
        .limit(DETAIL_LIST),
      // Attach-vendor control (Task 10): the roster a buyer link can be pointed at. Inactive
      // vendors are excluded here (not just refused by the RPC) so GC never even sees a dead
      // option in the picker.
      supabase.from("vendors").select("id, name").eq("active", true).order("name").range(...rangeFor(UNPAGINATED_MAX)),
    ]);

  // Widened to include recipient_name/vendor_id/vendors so the same read also feeds
  // BuyerLinks below — one query, two views of the same screener_view rows for this title.
  // Structurally a superset of ScreenerLink, so `links` still satisfies ScreenerPanel's prop.
  type ScreenerLinkRow = ScreenerLink & {
    recipient_name: string | null;
    vendor_id: string | null;
    vendors: { name: string } | null;
  };
  const links = (screenerLinks ?? []) as ScreenerLinkRow[];
  // The reusable share URL is built server-side (PORTAL_BASE_URL) from the live link's
  // persisted token. Newest live link with a token wins (list is created_at desc).
  const shareLink = links.find((l) => !l.revoked_at && new Date(l.expires_at) > new Date() && l.share_token);
  const portalBase = process.env.PORTAL_BASE_URL?.replace(/\/+$/, "") ?? "";
  const activeShareUrl = shareLink?.share_token ? `${portalBase}/portal/${shareLink.share_token}` : null;
  const engagementEntries = await Promise.all(
    links
      .filter((l) => !l.revoked_at)
      .map(async (l) => {
        const { data } = await supabase.rpc("screener_engagement", { p_link_id: l.id });
        return [l.id, (data ?? []) as ScreenerViewer[]] as const;
      }),
  );
  const engagement = Object.fromEntries(engagementEntries) as Record<string, ScreenerViewer[]>;

  // Active buyer links only: recipient_name set (a genuine named pitch, not GC's ambient
  // share link, which carries no recipient and is managed by ScreenerPanel above), not
  // revoked, not expired — attaching a vendor to a dead link is refused by the RPC anyway, so
  // there is nothing useful to offer the control for one here.
  const buyerLinks: BuyerLink[] = links
    .filter((l) => l.recipient_name && !l.revoked_at && new Date(l.expires_at) > new Date())
    .map((l) => ({
      id: l.id,
      recipientName: l.recipient_name as string,
      createdAt: l.created_at,
      vendorId: l.vendor_id,
      vendorName: l.vendors?.name ?? null,
    }));
  // Per-vendor "would attaching this one release the master right now" (fix round 1, item 3):
  // grouped from the same deliveries read the read-only Deliveries card already uses, mirroring
  // exactly what attach_link_vendor's own title_vendor_licensed check re-derives server-side —
  // this is a rendering hint only (so the operator sees it BEFORE clicking Attach), never the
  // authorization; the RPC re-checks independently and refuses regardless of what this said.
  const deliveriesByVendor = new Map<string, DeliveryForLicenceCheck[]>();
  for (const d of deliveries ?? []) {
    const list = deliveriesByVendor.get(d.vendor_id) ?? [];
    list.push({ status: d.status, territory: d.territory, grant: d.rights_grants as DeliveryForLicenceCheck["grant"] });
    deliveriesByVendor.set(d.vendor_id, list);
  }
  const vendorOptions: VendorOption[] = (activeVendors ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    releasesMasterNow: isMasterLicensed(deliveriesByVendor.get(v.id) ?? []),
  }));

  const meta = (metaRow?.data as Record<string, unknown>) ?? {};
  const inReview = t.status === "in_review";

  return (
    <>
      <div className="flex flex-col gap-0.5 pb-6">
        <h1 className="t-subhead text-ink">{t.title}</h1>
        <span className="t-body-sm text-ink-3">
          {t.catalog_id} · {t.organizations?.name ?? "—"} · {gcTitleStatusLabel(t.status as TitleStatus)}
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {/* Findings first — what needs attention on this title. */}
        <FindingsCard findings={findings ?? []} />

        {/* Release date — GC-owned go-to-market date (client cannot set it). */}
        <Card>
          <CardBody>
            <ReleaseDateControl
              titleId={t.id}
              releaseType={t.release_type as ReleaseType}
              originalReleaseDate={t.original_release_date}
              releaseDate={t.release_date}
            />
          </CardBody>
        </Card>

        {/* Rights & territories */}
        <Card>
          <CardBody className="flex flex-col gap-2">
            <span className="t-label text-ink-3">Rights &amp; territories</span>
            {(grants ?? []).length > 0 ? (
              (grants ?? []).map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-4">
                  <span className="t-body-sm text-ink-2">
                    {RIGHTS_META[g.rights_type].label} · {g.exclusive ? "Exclusive" : "Non-exclusive"}
                  </span>
                  <span className="shrink-0 t-body-sm text-ink-3">
                    {describeTerritory(g.territory_mode, g.territories)}
                  </span>
                </div>
              ))
            ) : (
              <span className="t-body-sm text-ink-3">No rights declared.</span>
            )}
            {(conflicts ?? []).length > 0 ? (
              <InlineNotice tone="error">
                Exclusive rights conflict on the same work:{" "}
                {(conflicts ?? [])
                  .map((c) => `${RIGHTS_META[c.rights_type].label} — ${c.other_title} (${c.other_org_name})`)
                  .join("; ")}
              </InlineNotice>
            ) : null}
          </CardBody>
        </Card>

        {/* Deliveries — where this title is placed, per vendor/territory (read-only here;
            GC sets status from the Deliveries queue). */}
        <Card>
          <CardBody className="flex flex-col gap-2">
            <span className="t-label text-ink-3">Deliveries</span>
            {(deliveries ?? []).length > 0 ? (
              (deliveries ?? []).map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-4">
                  <span className="t-body-sm text-ink-2">
                    {d.vendors?.name ?? "—"} · {d.territory}
                  </span>
                  <span className="shrink-0 t-body-sm text-ink-3">
                    {DELIVERY_STATUS_ROW_LABELS[d.status]}
                  </span>
                </div>
              ))
            ) : (
              <span className="t-body-sm text-ink-3">Not yet delivered.</span>
            )}
          </CardBody>
        </Card>

        {/* Metadata (read-only) */}
        <Card>
          <CardBody className="flex flex-col gap-1.5">
            <span className="t-label text-ink-3">Metadata</span>
            {METADATA_FIELDS.map((field) => (
              <div key={field.key} className="flex items-baseline justify-between gap-4 t-body-sm">
                <span className="text-ink-3">{field.label}</span>
                <span className="text-ink-2 text-right">{fmtMeta(meta[field.key])}</span>
              </div>
            ))}
          </CardBody>
        </Card>

        {/* Review actions — only while awaiting review */}
        {inReview ? (
          <Card>
            <CardBody className="flex flex-col gap-3">
              <span className="t-label text-ink-3">Review</span>
              {t.work_id ? null : (
                <LinkControls titleId={t.id} suggestions={(suggestions ?? []) as Suggestion[]} />
              )}
              <ReviewControls titleId={t.id} />
            </CardBody>
          </Card>
        ) : null}

        {/* Screener (external pitch link) + engagement */}
        <Card>
          <CardBody>
            <ScreenerPanel titleId={t.id} links={links} engagement={engagement} activeShareUrl={activeShareUrl} />
          </CardBody>
        </Card>

        {/* Buyer links (Task 10) — GC attaches the vendor once a deal closes. Nothing sets
            portal_links.vendor_id except this control (vendors is a GC-only roster the client
            never sees), so it is the one place the master's licence gate on a pitched link can
            ever be satisfied. */}
        <Card>
          <CardBody className="flex flex-col gap-2">
            <span className="t-label text-ink-3">Buyer links</span>
            <BuyerLinks titleId={t.id} links={buyerLinks} vendors={vendorOptions} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
