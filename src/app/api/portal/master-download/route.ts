import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { PORTAL } from "@/lib/portal";
import { assetViewUrl } from "@/lib/asset-url";
import { resolveOrRestore } from "@/lib/s3";
import { resolveBuyerLink } from "@/lib/portal-session";
import { buyerActionsFor } from "@/lib/buyer-page";
import { isMasterLicensed, type DeliveryForLicenceCheck } from "@/lib/master-licence";

// Buyer-portal MASTER download — the highest-risk route in this plan. It serves the
// crown-jewel deliverable, unwatermarked, to an external party over the public internet.
// Modeled directly on src/app/api/portal/download/route.ts (GC's vendor master-download
// route): same Glacier gate, same audit-before-return ordering, same fail-closed reasoning.
//
// NEVER TRUST THE PAGE. The "Download master" button's presence on title-page.tsx is a
// rendering decision made from data the client could not tamper with — but this route is
// the actual authorization, and it re-derives its own answer from freshly-read state on
// every request, ignoring whatever the client believes.
export async function POST(req: Request) {
  const raw = (await cookies()).get(PORTAL.sessionCookie)?.value;
  if (!raw) return NextResponse.json({ error: "No session" }, { status: 401 });

  const link = await resolveBuyerLink(raw);
  if (!link) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // A link with no vendor attached can never reach the master — refuse before querying.
  // (Vendors are attached by GC at deal time, Task 10; a pitch-stage link has none yet.)
  // Querying deliveries with vendor_id = null would find nothing anyway since deliveries.
  // vendor_id is NOT NULL, but this makes the refusal explicit rather than relying on that
  // schema fact holding forever.
  if (!link.vendorId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const admin = createAdminClient();

  const [{ data: titleRow }, { data: deliveryRows }] = await Promise.all([
    admin.from("titles").select("status").eq("id", link.titleId).maybeSingle(),
    admin
      .from("deliveries")
      .select("status, territory, rights_grants(effective_to, window_start, window_end, territory_mode, territories)")
      .eq("title_id", link.titleId)
      .eq("vendor_id", link.vendorId),
  ]);
  if (!titleRow) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // `licensed` is re-resolved HERE, from an active grant + delivery for THIS link's vendor
  // and THIS title — never carried in from the client, and never inferred from the title
  // alone. This is the entire reason links are scoped to (title, recipient): if this check
  // were keyed on the title only, the moment ANY vendor licensed the title, every OTHER
  // prospect still holding a screener_view link for it would qualify for the master too.
  // See lib/master-licence.ts for the gate itself and its rationale.
  const deliveries: DeliveryForLicenceCheck[] = (deliveryRows ?? []).map((d) => ({
    status: d.status,
    territory: d.territory,
    grant: d.rights_grants as DeliveryForLicenceCheck["grant"],
  }));
  const licensed = isMasterLicensed(deliveries);

  // Recompute buyerActionsFor server-side and refuse unless canDownloadMaster is true — the
  // ONE authorization check for this route, same predicate the page used to decide whether
  // to render the button, now re-derived from data the client never touched.
  const actions = buyerActionsFor({
    titleStatus: titleRow.status,
    hasScreenerAsset: false, // irrelevant to canDownloadMaster — not worth a second query here
    hasTrailer: false,
    licensed,
    screenerIsDedicated: false, // irrelevant to canDownloadMaster — see buyer-page.ts
  });
  if (!actions.canDownloadMaster) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Latest master asset wins — same tie-break used elsewhere (page.tsx, screener resolution):
  // a re-uploaded master must supersede the old one, never race it for which key gets served.
  const { data: masterAsset } = await admin
    .from("assets")
    .select("storage_key")
    .eq("title_id", link.titleId)
    .eq("kind", "master")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!masterAsset) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // Glacier gate: a licensed master may be tiered to cold storage. resolveOrRestore HEADs
  // the object (source of truth) and auto-initiates a Standard restore on first hit.
  // "restoring" → 409 "preparing"; the page maps 409 to the cold-storage message and the
  // recipient returns to the same link once it completes.
  const restore = await resolveOrRestore(masterAsset.storage_key);
  if (restore.status === "restoring") {
    if (restore.justInitiated) {
      // best-effort provenance — a log failure (error OR thrown) must NOT turn "preparing"
      // into an error; the restore has already been initiated.
      try {
        await admin.from("portal_access_events").insert({
          link_id: link.linkId,
          session_id: link.sessionId,
          event_type: "restore_requested",
          user_agent: req.headers.get("user-agent") ?? null,
        });
      } catch {
        /* swallow — provenance is best-effort here */
      }
    }
    return NextResponse.json({ error: "File is being prepared" }, { status: 409 });
  }

  let url: string;
  try {
    // Single-GET download TTL, not the streaming TTL — a master download is one GET that
    // must start within the window, not a <video> re-validating across a whole playback.
    url = await assetViewUrl(masterAsset.storage_key, PORTAL.signedUrlTtlSeconds);
  } catch (err) {
    // A signing failure here is a CONFIG problem (missing/misconfigured CloudFront env), not
    // "still restoring" — the Glacier case is handled above and never reaches this catch.
    // Masquerading it as 409 would render the page's cold-storage copy ("usually takes 3 to
    // 5 hours") over what is actually a deploy-config bug that will never resolve on its own.
    console.error("[portal:master-download] signing failed", err);
    return NextResponse.json({ error: "Could not prepare download" }, { status: 500 });
  }

  // The download event is THE provenance record for "who downloaded the master" (rule 5).
  // If we can't record it, fail closed rather than serve an unauditable master — the client
  // never receives the (as-yet-unused) signed URL, so no untraceable download can occur.
  const { error: logErr } = await admin.from("portal_access_events").insert({
    link_id: link.linkId,
    session_id: link.sessionId,
    event_type: "download",
    user_agent: req.headers.get("user-agent") ?? null,
  });
  if (logErr) return NextResponse.json({ error: "Could not record access" }, { status: 500 });

  return NextResponse.json({ type: "progressive", url });
}
