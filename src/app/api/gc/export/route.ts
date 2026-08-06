import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { parseExportSpec, STANDARD_EXPORT_TEMPLATE } from "@/lib/export-spec";
import { buildExportRows, toXlsx, type TitleExportInput } from "@/lib/export-engine";
import { EXPORT_MAX_TITLES } from "@/lib/list-bounds";

// GC-only export download: gather vendor spec + title metadata + per-title offer
// (from deliveries→rights_grants), run the engine, record the snapshot via
// record_export (append-only provenance), return the .xlsx.
export async function POST(req: Request) {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: staff } = await supabase.from("gc_staff").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json()) as { vendorId?: string; titleIds?: string[] };
  const vendorId = body.vendorId;
  const titleIds = (body.titleIds ?? []).filter(Boolean);
  if (!vendorId || titleIds.length === 0) return NextResponse.json({ error: "pick a vendor and titles" }, { status: 400 });
  // An export must be COMPLETE or REFUSED — never quietly partial. PostgREST caps results
  // at max_rows (1000) with no error, so a large selection would have produced a truncated
  // .xlsx and shipped it to a distribution partner as if it were the whole catalogue.
  // Refusing is the only safe behaviour; a vendor acting on a short file is worse than a
  // failed download.
  if (titleIds.length > EXPORT_MAX_TITLES) {
    return NextResponse.json(
      {
        error: `Too many titles for one export (${titleIds.length}). ` +
          `Export at most ${EXPORT_MAX_TITLES} at a time so the file is guaranteed complete.`,
      },
      { status: 400 },
    );
  }

  const { data: vendor } = await supabase.from("vendors").select("name, export_format_spec").eq("id", vendorId).maybeSingle();
  if (!vendor) return NextResponse.json({ error: "vendor not found" }, { status: 404 });

  const parsed = vendor.export_format_spec ? parseExportSpec(vendor.export_format_spec) : null;
  const spec = parsed && parsed.ok ? parsed.spec : STANDARD_EXPORT_TEMPLATE;

  const { data: titleRows, error: titlesErr } = await supabase
    .from("titles").select("id, catalog_id, title").in("id", titleIds).order("catalog_id");
  const { data: metaRows, error: metaErr } = await supabase
    .from("title_metadata").select("title_id, data").in("title_id", titleIds);
  const { data: dlvRows, error: dlvErr } = await supabase
    .from("deliveries")
    .select("title_id, territory, rights_grants(rights_type, window_end)")
    .eq("vendor_id", vendorId).in("title_id", titleIds);

  if (titlesErr || metaErr || dlvErr) {
    return NextResponse.json({ error: "failed to gather export data" }, { status: 500 });
  }

  // COMPLETENESS ASSERTION. The guard above bounds the request, but this proves the result:
  // if the database returned fewer titles than were asked for — a row cap, an RLS filter, a
  // deleted id — we must not build a file from it. Silence here means a vendor receives a
  // catalogue that is short by rows nobody will notice are missing.
  const returned = titleRows?.length ?? 0;
  if (returned !== titleIds.length) {
    console.error(
      `[gc:export] requested ${titleIds.length} titles, got ${returned} — refusing to emit a partial export`,
    );
    return NextResponse.json(
      {
        error: `Export aborted: ${returned} of ${titleIds.length} titles could be read. ` +
          `No file was produced rather than an incomplete one.`,
      },
      { status: 409 },
    );
  }

  const resolvedIds = (titleRows ?? []).map((t) => t.id);
  if (resolvedIds.length === 0) {
    return NextResponse.json({ error: "no matching titles" }, { status: 400 });
  }

  const metaByTitle = new Map((metaRows ?? []).map((m) => [m.title_id, (m.data as Record<string, unknown>) ?? {}]));
  const offerByTitle = new Map<string, TitleExportInput["offer"]>();
  for (const d of dlvRows ?? []) {
    const g = (d.rights_grants ?? {}) as { rights_type?: string; window_end?: string | null };
    if (!g.rights_type) continue;
    const arr = offerByTitle.get(d.title_id) ?? [];
    arr.push({ rightsType: g.rights_type, territory: d.territory, windowEnd: g.window_end ?? null });
    offerByTitle.set(d.title_id, arr);
  }

  const inputs: TitleExportInput[] = (titleRows ?? []).map((t) => ({
    catalogId: t.catalog_id ?? "",
    title: t.title ?? "",
    metadata: metaByTitle.get(t.id) ?? {},
    offer: offerByTitle.get(t.id) ?? [],
  }));

  const { headers, rows } = buildExportRows(spec, inputs);
  const payload = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
  const { error: recErr } = await supabase.rpc("record_export", {
    p_vendor_id: vendorId,
    p_title_ids: resolvedIds,
    p_payload: payload,
  });
  if (recErr) {
    return NextResponse.json({ error: "failed to record export" }, { status: 500 });
  }

  const buf = await toXlsx(headers, rows, spec.sheet_name ?? "Titles");
  const safeVendor = vendor.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${safeVendor}-titles.xlsx"`,
    },
  });
}
