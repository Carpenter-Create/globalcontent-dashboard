import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, PORTAL, PORTAL_COPY } from "@/lib/portal";
import { assetViewUrl } from "@/lib/asset-url";
import { buyerActionsFor } from "@/lib/buyer-page";
import { isMasterLicensed, type DeliveryForLicenceCheck } from "@/lib/master-licence";
import { Card, CardBody } from "@/components/ui/card";
import { PortalFlow } from "./portal-flow";

// Server Component: resolves link validity with the service-role admin client (no
// user JWT exists for an account-less recipient) before handing off to the client
// flow. An invalid/expired/revoked link renders the same expired-link card either
// way — never leaks *why* to an unauthenticated caller.
export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("portal_links")
    .select(
      "id, expires_at, revoked_at, purpose, title_id, recipient_name, vendor_id, assets(original_filename, bytes)",
    )
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  const valid = link && !link.revoked_at && new Date(link.expires_at) >= new Date();
  if (!valid) {
    return (
      <Card>
        <CardBody>
          <h1 className="t-subhead mb-2">{PORTAL_COPY.roomTitle}</h1>
          <p className="t-body text-ink-2">{PORTAL_COPY.errorExpired}</p>
        </CardBody>
      </Card>
    );
  }

  if (link.purpose === "screener_view" && link.title_id) {
    const titleId = link.title_id;
    // Curated title info for display only — not authz. The actual stream is re-resolved
    // session-side by portal_resolve_screener (service-role, no rule-12 gate: pitch view),
    // and the master download re-resolves `licensed` all over again itself (never trusts this
    // render — see master-download/route.ts). Four independent reads, one Promise.all — the
    // delivery query is skipped entirely (Promise.resolve, not a query) when the link has no
    // vendor attached yet: an unattached link can never have a matching delivery row, so
    // asking is a pointless round-trip on every single page load.
    const [{ data: titleRow }, { data: metaRow }, { data: titleAssets }, { data: deliveryRows }] =
      await Promise.all([
        admin
          .from("titles")
          .select("title, catalog_id, status, org_id, screener_source")
          .eq("id", titleId)
          .maybeSingle(),
        admin.from("title_metadata").select("data").eq("title_id", titleId).maybeSingle(),
        admin.from("assets").select("kind, storage_key, created_at").eq("title_id", titleId),
        link.vendor_id
          ? admin
              .from("deliveries")
              .select(
                "status, territory, rights_grants(effective_to, window_start, window_end, territory_mode, territories)",
              )
              .eq("title_id", titleId)
              .eq("vendor_id", link.vendor_id)
          : Promise.resolve({ data: null }),
      ]);

    const meta = (metaRow?.data ?? {}) as Record<string, unknown> & {
      synopsis?: string;
      runtime_minutes?: number;
    };
    const assetList = titleAssets ?? [];

    // Latest of each kind wins — same tie-break as titleArtworkUrls (artwork.ts): a
    // re-uploaded poster/banner must supersede the old one, never race it for display.
    const latestKeyOf = (kind: string) =>
      assetList
        .filter((a) => a.kind === kind)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.storage_key ?? null;

    const posterKey = latestKeyOf("poster");
    const bannerKey = latestKeyOf("banner");
    // The asset list above already carries the trailer row (unfiltered by kind), so this
    // needs no new query — only a sign.
    const trailerKey = latestKeyOf("trailer");
    // Artwork TTL, not the download TTL (see the comment on PORTAL.artworkTtlSeconds) — this
    // page can stay open far longer than a single GET. stableWindow matches artwork.ts so the
    // browser caches the image across the hour instead of re-fetching on every navigation.
    // Signing depends on the asset list above, so it cannot join the first Promise.all — but
    // the signs are still parallel, and a signing failure degrades to null (placeholder or a
    // hidden trailer), never a crashed page: artwork is decoration, not data.
    //
    // Trailer gets the SCREENER's TTL, not the artwork TTL — this is mechanical, not about
    // sensitivity. A <video> issues byte-range GETs across the whole runtime and CloudFront
    // re-validates the signed URL on every one of them (see the comment on
    // screenerStreamTtlSeconds), so the TTL must outlive playback-plus-pauses, not just an
    // initial fetch the way an <img> only needs. A buyer who reads the spec sheet for an hour
    // before pressing play must not get a trailer that dies mid-request.
    const [posterUrl, bannerUrl, trailerUrl] = await Promise.all([
      posterKey
        ? assetViewUrl(posterKey, PORTAL.artworkTtlSeconds, { stableWindow: true }).catch(() => null)
        : Promise.resolve(null),
      bannerKey
        ? assetViewUrl(bannerKey, PORTAL.artworkTtlSeconds, { stableWindow: true }).catch(() => null)
        : Promise.resolve(null),
      trailerKey
        ? assetViewUrl(trailerKey, PORTAL.screenerStreamTtlSeconds, { stableWindow: true }).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Which asset IS the screener depends on the title's source setting — the same split
    // /api/portal/screener already makes.
    const screenerIsDedicated = titleRow?.screener_source === "dedicated";
    const screenerKind = screenerIsDedicated ? "screener" : "master";

    // ONE rule, two callers (fix round 1, task 9, item 3): this must be the exact same
    // isMasterLicensed the master-download route calls, on the exact same shape of rows —
    // not a cheaper `Boolean(delivery)` stand-in. That stand-in only checked delivery status
    // and skipped the grant entirely, so a `live` delivery under an EXPIRED grant rendered
    // the "Download master" button and then 403'd, which the page shows as "this link has
    // expired or been withdrawn" — telling a still-licensed buyer their access was pulled.
    const deliveries: DeliveryForLicenceCheck[] = (deliveryRows ?? []).map((d) => ({
      status: d.status,
      territory: d.territory,
      grant: d.rights_grants as DeliveryForLicenceCheck["grant"],
    }));
    const licensed = isMasterLicensed(deliveries);

    const actions = buyerActionsFor({
      titleStatus: titleRow?.status ?? null,
      hasScreenerAsset: assetList.some((a) => a.kind === screenerKind),
      hasTrailer: assetList.some((a) => a.kind === "trailer"),
      licensed,
      screenerIsDedicated,
    });

    return (
      <PortalFlow
        token={token}
        ready={{
          mode: "screener",
          title: titleRow?.title ?? PORTAL_COPY.unknownTitle,
          catalogId: titleRow?.catalog_id ?? null,
          synopsis: meta.synopsis ?? null,
          runtimeMinutes: meta.runtime_minutes ?? null,
          metadata: meta,
          posterUrl,
          bannerUrl,
          trailerUrl,
          recipientName: link.recipient_name ?? null,
          actions,
        }}
      />
    );
  }

  const asset = Array.isArray(link.assets) ? link.assets[0] : link.assets;
  return (
    <PortalFlow
      token={token}
      ready={{
        mode: "download",
        filename: asset?.original_filename ?? PORTAL_COPY.unknownFilename,
        bytes: asset?.bytes ?? 0,
      }}
    />
  );
}
