import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { PORTAL } from "@/lib/portal";
import { resolveBuyerLink } from "@/lib/portal-session";
import { parseExportSpec, BUYER_EXPORT_TEMPLATE } from "@/lib/export-spec";
import { buildExportRows, toXlsx } from "@/lib/export-engine";
import { buildExportFilename } from "@/lib/export-filename";

// Buyer-portal metadata export — backs the "Download metadata" button on the title page.
// Unlike the screener and master routes, buyerActionsFor.canDownloadMetadata is
// unconditionally true (it's the pitch material — a buyer evaluating a title needs the
// spec sheet whether or not a screener even exists yet; see buyer-page.ts). There is no
// status/licence flag to recompute here — the only thing that varies per request is WHICH
// spec to render.
export async function POST(req: Request) {
  const raw = (await cookies()).get(PORTAL.sessionCookie)?.value;
  if (!raw) return NextResponse.json({ error: "No session" }, { status: 401 });

  const link = await resolveBuyerLink(raw);
  if (!link) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const admin = createAdminClient();

  const [{ data: titleRow }, { data: metaRow }, vendorResult] = await Promise.all([
    admin.from("titles").select("catalog_id, title").eq("id", link.titleId).maybeSingle(),
    admin.from("title_metadata").select("data").eq("title_id", link.titleId).maybeSingle(),
    link.vendorId
      ? admin.from("vendors").select("export_format_spec").eq("id", link.vendorId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!titleRow) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // vendorSpec is the recipient vendor's export_format_spec, and ONLY when the link carries
  // a vendor_id and that vendor has one configured (Task 10 attaches the vendor; not every
  // link has one at pitch time) — otherwise the buyer-safe standard template. A spec that
  // fails to parse (a hand-edited or stale row) degrades to the fallback rather than 500ing
  // a buyer's download; the failure is logged so the bad spec gets fixed, never swallowed.
  const rawSpec = vendorResult.data?.export_format_spec;
  let spec = BUYER_EXPORT_TEMPLATE;
  if (rawSpec) {
    const parsed = parseExportSpec(rawSpec);
    if (parsed.ok) {
      spec = parsed.spec;
    } else {
      console.error(
        `[portal:metadata-export] invalid export_format_spec for vendor ${link.vendorId}: ${parsed.error}`,
      );
    }
  }

  const { headers, rows } = buildExportRows(spec, [
    {
      catalogId: titleRow.catalog_id ?? "",
      title: titleRow.title,
      metadata: (metaRow?.data ?? {}) as Record<string, unknown>,
      offer: [], // a prospective buyer has no offer of their own — see BUYER_EXPORT_TEMPLATE
    },
  ]);
  const buf = await toXlsx(headers, rows, spec.sheet_name ?? "Title");
  const filename = buildExportFilename({
    catalogId: titleRow.catalog_id ?? "",
    title: titleRow.title,
    date: new Date(),
    recipient: link.recipientName,
  });

  // Provenance record for this recipient's access (rule 5), same fail-closed shape as the
  // screener and master routes: the file is only returned once the event is durably recorded.
  const { error: logErr } = await admin.from("portal_access_events").insert({
    link_id: link.linkId,
    session_id: link.sessionId,
    event_type: "download",
    user_agent: req.headers.get("user-agent") ?? null,
  });
  if (logErr) return NextResponse.json({ error: "Could not record access" }, { status: 500 });

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // filename comes from buildExportFilename, which slugs every segment itself — never
      // interpolate a raw title/recipient value into this header directly (it's how a
      // Content-Disposition header gets split/injected).
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
