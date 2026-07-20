# Export mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click, endpoint-formatted `.xlsx` metadata sheets GC attaches to pitch emails — a deterministic mapping engine (canonical → vendor columns), a GC download route, an append-only export log, and the missing required-metadata submission gate.

**Architecture:** A pure lib maps canonical `title_metadata` + the aggregated delivery offer through a typed `export_format_spec` (vendor's, or the GC standard template) and serializes to `.xlsx` via `exceljs`. A GC-only route gathers the data, runs the engine, records a snapshot, and returns the file. Writes are GC-only; nothing contacts an endpoint. Metadata-only (no asset links).

**Tech Stack:** Supabase Postgres (RLS, SECURITY DEFINER RPC, pgTAP), Next.js App Router (route handler + client selection UI), TypeScript strict, zod, `exceljs`, Vitest, Tailwind + GC tokens.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-19-export-mapping-design.md`. Domain: `docs/domain-spec.md` §13/§19.
- **Branch:** `feat/export-mapping` off `main` (`70becf3`).
- **Migration filename:** `supabase/migrations/20260719000700_export_and_submit_gate.sql` (sorts after `…000600`).
- **App never contacts an endpoint** — export is a *download* only.
- **Output `.xlsx`** via `exceljs` (maintained; NOT the SheetJS `xlsx` package). Server-side only — must not enter the client bundle.
- **Grain:** one sheet per endpoint, **one row per title** (GC-selected), each row = descriptive metadata + **aggregated offer** (rights · territories · window) from that title's deliveries to the endpoint. Status is not a column.
- **Template resolution:** `vendors.export_format_spec` (validated) if present, else `STANDARD_EXPORT_TEMPLATE`.
- **Bounded transforms:** `none | number_format | date_format | list_join | enum_map | truncate`; `max_length`/`truncate` cap = the future §19 limit. Missing values → blank cell + a warning (never invented).
- **Log every export** as an append-only snapshot (`export_records`): vendor, title_ids, the exported rows, who, when.
- **Required-metadata gate:** `submit_title` must block submission unless the REQUIRED canonical fields (`synopsis, runtime_minutes, release_year, genre, primary_language, country_of_origin` — the REQUIRED tier in `src/lib/metadata.ts`) are present + non-empty.
- **Conventions:** UUID/`timestamptz`/`snake_case`; regenerate `database.types.ts` after the migration; design tokens; TS strict; run `leak-check` (confirm `exceljs` stays server-only).
- **Destructive-ops (approved before apply):** create table + functions; revokes; replace `submit_title`. Founder runs `supabase db reset` + `gen types`.
- **Out of scope (seams):** asset-access portal (signing + OTP), C-override (engine reads a resolved view so it slots in), structured spec editor (v1 edits validated JSON), non-xlsx formats, localization.

---

### Task 1: Migration — `export_records` + `record_export` RPC + `submit_title` required-metadata gate

**Files:**
- Create: `supabase/migrations/20260719000700_export_and_submit_gate.sql`
- Modify (founder-run regen): `src/lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: `vendors`, `titles`, `title_metadata`, `is_gc_staff`, `member_can`.
- Produces: table `export_records`; `record_export(uuid, uuid[], jsonb) returns uuid`; replaced `submit_title(uuid, uuid)`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- 20260719000700_export_and_submit_gate.sql
--
-- INTENT: (1) export_records — append-only snapshot of every metadata export GC
-- produces (provenance: what GC represented to an endpoint), written only via the
-- GC-only record_export RPC. (2) submit_title gains a REQUIRED-metadata gate so a
-- title can't be turned in to GC without its required fields — export relies on this.
--
-- DESTRUCTIVE OPS (approved before apply): create table + functions; revokes;
-- replace submit_title (signature unchanged). Forward-only + idempotent.
-- ============================================================================

create table if not exists public.export_records (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors(id) on delete restrict,
  title_ids   uuid[] not null,
  payload     jsonb not null,          -- the exact rows exported (snapshot)
  exported_by uuid references auth.users(id),
  exported_at timestamptz not null default now()
);
create index if not exists export_records_vendor_idx on public.export_records (vendor_id);
create index if not exists export_records_at_idx on public.export_records (exported_at desc);

alter table public.export_records enable row level security;
revoke all on public.export_records from anon;
revoke insert, update, delete on public.export_records from authenticated, service_role;  -- RPC-only, immutable
drop policy if exists export_records_select on public.export_records;
create policy export_records_select on public.export_records for select to authenticated
  using (public.is_gc_staff(auth.uid()));

create or replace function public.record_export(p_vendor_id uuid, p_title_ids uuid[], p_payload jsonb)
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  insert into public.export_records (vendor_id, title_ids, payload, exported_by)
  values (p_vendor_id, p_title_ids, p_payload, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.record_export(uuid, uuid[], jsonb) from public, anon;
grant  execute on function public.record_export(uuid, uuid[], jsonb) to authenticated;

-- submit_title: add the required-metadata gate (signature unchanged → create or replace).
create or replace function public.submit_title(p_org_id uuid, p_title_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_data jsonb;
  v_key  text;
  -- REQUIRED tier from src/lib/metadata.ts METADATA_FIELDS — keep in sync.
  v_required text[] := array['synopsis','runtime_minutes','release_year','genre','primary_language','country_of_origin'];
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized to submit titles for this organization';
  end if;

  select data into v_data from public.title_metadata where title_id = p_title_id;
  foreach v_key in array v_required loop
    if v_data is null or coalesce(btrim(v_data->>v_key), '') = '' then
      raise exception 'Cannot submit: required metadata field "%" is missing', v_key;
    end if;
  end loop;

  update public.titles
    set status = 'in_review'
    where id = p_title_id and org_id = p_org_id and status = 'draft';
  if not found then
    raise exception 'Title not found in this organization, or not in draft';
  end if;
end;
$$;
revoke execute on function public.submit_title(uuid, uuid) from public, anon;
grant  execute on function public.submit_title(uuid, uuid) to authenticated;
```

- [ ] **Step 2: Show destructive SQL for approval; founder applies + regenerates**

```
! supabase db reset
! supabase gen types typescript --local > src/lib/supabase/database.types.ts
```
Verify: starts `export type Json =`, ends `} as const`, no CLI noise; `export_records` + `record_export` present; `submit_title` Args unchanged.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260719000700_export_and_submit_gate.sql src/lib/supabase/database.types.ts
git commit -m "feat(db): export_records + record_export RPC + submit_title required-metadata gate"
```

---

### Task 2: pgTAP — submit gate + record_export immutability/RLS

**Files:** Create: `supabase/tests/export_test.sql`

- [ ] **Step 1: Write the test**

```sql
-- export_test.sql
-- submit_title required-metadata gate; record_export GC-only + append-only + RLS.

begin;
select plan(7);

select set_config('t.org', gen_random_uuid()::text, false);
select set_config('t.owner', gen_random_uuid()::text, false);
select set_config('t.gc', gen_random_uuid()::text, false);
select set_config('t.title', gen_random_uuid()::text, false);
select set_config('t.vendor', gen_random_uuid()::text, false);

insert into auth.users (id) values (current_setting('t.owner')::uuid), (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values (current_setting('t.org')::uuid, 'Org A');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org')::uuid, current_setting('t.owner')::uuid, 'account_owner', 'active');
insert into public.gc_staff (user_id, role) values (current_setting('t.gc')::uuid, 'gc_delivery_ops');
insert into public.titles (id, org_id, title) values
  (current_setting('t.title')::uuid, current_setting('t.org')::uuid, 'Film');
insert into public.vendors (id, name, delivery_mode) values
  (current_setting('t.vendor')::uuid, 'Endpoint', 'portal_upload');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);

-- submit blocked: no metadata at all
select throws_ok(
  format($$ select public.submit_title(%L, %L) $$, current_setting('t.org'), current_setting('t.title')),
  'P0001', null, 'submit blocked when required metadata missing (no row)');

-- submit blocked: partial metadata (missing country_of_origin)
reset role;
insert into public.title_metadata (title_id, org_id, data) values
  (current_setting('t.title')::uuid, current_setting('t.org')::uuid,
   '{"synopsis":"x","runtime_minutes":100,"release_year":2024,"genre":"drama","primary_language":"en"}'::jsonb);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select public.submit_title(%L, %L) $$, current_setting('t.org'), current_setting('t.title')),
  'P0001', null, 'submit blocked when a required field missing (country_of_origin)');

-- submit succeeds once all required present
reset role;
update public.title_metadata set data = data || '{"country_of_origin":"US"}'::jsonb
  where title_id = current_setting('t.title')::uuid;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select lives_ok(
  format($$ select public.submit_title(%L, %L) $$, current_setting('t.org'), current_setting('t.title')),
  'submit succeeds when all required metadata present');
select is((select status::text from public.titles where id = current_setting('t.title')::uuid),
  'in_review', 'title advanced to in_review');

-- record_export: client denied, GC ok, append-only
select throws_ok(
  format($$ select public.record_export(%L, array[%L]::uuid[], '{}'::jsonb) $$, current_setting('t.vendor'), current_setting('t.title')),
  'P0001', 'Not authorized', 'client: record_export denied');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select lives_ok(
  format($$ select public.record_export(%L, array[%L]::uuid[], '[{"Title":"Film"}]'::jsonb) $$, current_setting('t.vendor'), current_setting('t.title')),
  'gc: record_export succeeds');
select throws_ok(
  $$ update public.export_records set payload = '{}'::jsonb $$,
  '42501', null, 'export_records is append-only (direct UPDATE denied)');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run** — `supabase test db` → `export_test.sql ... ok` (7/7), `All tests successful.` (Fix minimally: align `plan(N)`; the `title_metadata`/`titles`/`vendors` fixture inserts run as superuser via `reset role` since those tables have no direct-INSERT policy.)

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/export_test.sql
git commit -m "test(db): submit required-metadata gate + record_export append-only/RLS"
```

---

### Task 3: Export spec schema + mapping engine + Vitest

**Files:**
- Modify: `package.json` (add `exceljs`)
- Create: `src/lib/export-spec.ts`, `src/lib/export-engine.ts`
- Create: `src/lib/export-engine.test.ts`, `src/lib/export-spec.test.ts`

**Interfaces:**
- Produces: `parseExportSpec`, `STANDARD_EXPORT_TEMPLATE`, `type ExportFormatSpec`; `buildExportRows(spec, titles)`, `renderOffer(offer)`, `toXlsx(headers, rows, sheetName)`.

- [ ] **Step 1: Add the dependency** — `npm install exceljs` (server-side xlsx). Confirm it lands in `dependencies`.

- [ ] **Step 2: `src/lib/export-spec.ts`** (zod schema + the founder-confirmable standard template)

```ts
import { z } from "zod";
import { METADATA_FIELDS } from "@/lib/metadata";

const FIELD_KEYS = METADATA_FIELDS.map((f) => f.key) as [string, ...string[]];

const transform = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("number_format"), pattern: z.string().optional() }),
  z.object({ type: z.literal("date_format"), pattern: z.string() }),
  z.object({ type: z.literal("list_join"), delimiter: z.string() }),
  z.object({ type: z.literal("enum_map"), map: z.record(z.string(), z.string()) }),
  z.object({ type: z.literal("truncate"), max: z.number().int().positive() }),
]);

const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field"), key: z.enum(FIELD_KEYS) }),
  z.object({ kind: z.literal("catalog_id") }),
  z.object({ kind: z.literal("offer") }),
  z.object({ kind: z.literal("static"), value: z.string() }),
]);

export const exportColumnSchema = z.object({
  header: z.string().min(1),
  source,
  transform: transform.optional(),
  max_length: z.number().int().positive().optional(),
});
export const exportSpecSchema = z.object({
  format: z.literal("xlsx"),
  sheet_name: z.string().optional(),
  columns: z.array(exportColumnSchema).min(1),
});
export type ExportFormatSpec = z.infer<typeof exportSpecSchema>;
export type ExportColumn = z.infer<typeof exportColumnSchema>;

export function parseExportSpec(raw: unknown): { ok: true; spec: ExportFormatSpec } | { ok: false; error: string } {
  const r = exportSpecSchema.safeParse(raw);
  return r.success ? { ok: true, spec: r.data } : { ok: false, error: r.error.issues[0]?.message ?? "Invalid export spec" };
}

// Global Content standard template — DRAFT (founder confirms the exact columns at
// implementation). Used when a vendor has no export_format_spec.
export const STANDARD_EXPORT_TEMPLATE: ExportFormatSpec = {
  format: "xlsx",
  sheet_name: "Titles",
  columns: [
    { header: "Catalog ID", source: { kind: "catalog_id" } },
    { header: "Title", source: { kind: "field", key: "alternate_title" } },
    { header: "Synopsis", source: { kind: "field", key: "synopsis" } },
    { header: "Runtime (min)", source: { kind: "field", key: "runtime_minutes" } },
    { header: "Year", source: { kind: "field", key: "release_year" } },
    { header: "Genre", source: { kind: "field", key: "genre" } },
    { header: "Language", source: { kind: "field", key: "primary_language" } },
    { header: "Country", source: { kind: "field", key: "country_of_origin" } },
    { header: "Director", source: { kind: "field", key: "director" } },
    { header: "Cast", source: { kind: "field", key: "cast" }, transform: { type: "list_join", delimiter: ", " } },
    { header: "Rating", source: { kind: "field", key: "rating" } },
    { header: "Offer", source: { kind: "offer" } },
  ],
};
```

- [ ] **Step 3: `src/lib/export-engine.ts`** (pure mapping + offer rendering + xlsx serialization)

```ts
import ExcelJS from "exceljs";
import type { ExportColumn, ExportFormatSpec } from "@/lib/export-spec";

export type OfferLine = { rightsType: string; territory: string; windowEnd: string | null };
export type TitleExportInput = {
  catalogId: string;
  metadata: Record<string, unknown>;
  offer: OfferLine[]; // the title's deliveries to the endpoint
};

// "SVOD: US, CA (through 2027) · AVOD: Worldwide" — grouped by rights type.
export function renderOffer(offer: OfferLine[]): string {
  const byRight = new Map<string, { terrs: Set<string>; window: string | null }>();
  for (const o of offer) {
    const g = byRight.get(o.rightsType) ?? { terrs: new Set(), window: o.windowEnd };
    g.terrs.add(o.territory);
    byRight.set(o.rightsType, g);
  }
  return [...byRight.entries()]
    .map(([rt, g]) => {
      const terrs = [...g.terrs].sort().join(", ");
      const win = g.window ? ` (through ${g.window.slice(0, 10)})` : "";
      return `${rt.toUpperCase()}: ${terrs}${win}`;
    })
    .join(" · ");
}

function applyTransform(value: unknown, col: ExportColumn): { text: string; warning?: string } {
  const t = col.transform;
  let out: string;
  if (value === null || value === undefined || value === "") out = "";
  else if (Array.isArray(value)) out = value.join(t?.type === "list_join" ? t.delimiter : ", ");
  else out = String(value);

  if (t?.type === "enum_map") out = t.map[out] ?? out;
  if (t?.type === "number_format" && out !== "") out = out; // v1: pass-through numeric text
  // date_format v1: pass-through ISO (real patterning added when a vendor needs it)

  let warning: string | undefined;
  const cap = col.max_length ?? (t?.type === "truncate" ? t.max : undefined);
  if (cap && out.length > cap) {
    out = out.slice(0, cap);
    warning = `"${col.header}" truncated to ${cap} chars`;
  }
  return { text: out, warning };
}

export function buildExportRows(spec: ExportFormatSpec, titles: TitleExportInput[]): {
  headers: string[];
  rows: string[][];
  warnings: string[];
} {
  const headers = spec.columns.map((c) => c.header);
  const warnings: string[] = [];
  const rows = titles.map((t) =>
    spec.columns.map((col) => {
      let raw: unknown;
      switch (col.source.kind) {
        case "catalog_id": raw = t.catalogId; break;
        case "offer": raw = renderOffer(t.offer); break;
        case "static": raw = col.source.value; break;
        case "field": raw = t.metadata[col.source.key]; break;
      }
      const { text, warning } = applyTransform(raw, col);
      if (col.source.kind === "field" && (raw === null || raw === undefined || raw === "")) {
        warnings.push(`${t.catalogId}: "${col.header}" is blank`);
      }
      if (warning) warnings.push(`${t.catalogId}: ${warning}`);
      return text;
    }),
  );
  return { headers, rows, warnings };
}

export async function toXlsx(headers: string[], rows: string[][], sheetName = "Titles"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
```

- [ ] **Step 4: Vitest tests** — `src/lib/export-engine.test.ts` (renderOffer grouping; buildExportRows: field lookup, catalog_id, static, list_join, enum_map, truncate + warning, blank + warning, header/row shape) and `src/lib/export-spec.test.ts` (valid spec parses; invalid transform/source rejected; STANDARD_EXPORT_TEMPLATE parses). Assert real values (e.g. `renderOffer([{rightsType:'svod',territory:'US',windowEnd:null},{rightsType:'svod',territory:'CA',windowEnd:null}])` === `"SVOD: CA, US"`).

- [ ] **Step 5: Run + commit** — `npx vitest run src/lib/export-engine.test.ts src/lib/export-spec.test.ts` green; `npm run typecheck && npm run lint` green.

```bash
git add package.json package-lock.json src/lib/export-spec.ts src/lib/export-engine.ts src/lib/export-engine.test.ts src/lib/export-spec.test.ts
git commit -m "feat(export): export-format-spec schema + deterministic mapping engine (exceljs) + tests"
```

---

### Task 4: Download route + vendor spec validation + GC selection UI

**Files:**
- Create: `src/app/api/gc/export/route.ts`
- Create: `src/app/gc/deliveries/export-panel.tsx`
- Modify: `src/app/gc/deliveries/page.tsx` (mount the export panel with endpoint/title options)
- Modify: `src/app/gc/vendors/actions.ts` (validate `export_format_spec` against `parseExportSpec`)

**Interfaces:** Consumes Task 1 (`record_export`) + Task 3 (engine). Produces `POST /api/gc/export`.

- [ ] **Step 1: The download route** (`src/app/api/gc/export/route.ts`)

```ts
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { parseExportSpec, STANDARD_EXPORT_TEMPLATE } from "@/lib/export-spec";
import { buildExportRows, toXlsx, type TitleExportInput } from "@/lib/export-engine";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: staff } = await supabase.from("gc_staff").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!staff) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json()) as { vendorId?: string; titleIds?: string[] };
  const vendorId = body.vendorId;
  const titleIds = (body.titleIds ?? []).filter(Boolean);
  if (!vendorId || titleIds.length === 0) return NextResponse.json({ error: "pick a vendor and titles" }, { status: 400 });

  const { data: vendor } = await supabase.from("vendors").select("name, export_format_spec").eq("id", vendorId).maybeSingle();
  if (!vendor) return NextResponse.json({ error: "vendor not found" }, { status: 404 });

  const parsed = vendor.export_format_spec ? parseExportSpec(vendor.export_format_spec) : null;
  const spec = parsed && parsed.ok ? parsed.spec : STANDARD_EXPORT_TEMPLATE;

  const { data: titleRows } = await supabase
    .from("titles").select("id, catalog_id").in("id", titleIds);
  const { data: metaRows } = await supabase
    .from("title_metadata").select("title_id, data").in("title_id", titleIds);
  const { data: dlvRows } = await supabase
    .from("deliveries")
    .select("title_id, territory, rights_grants(rights_type, window_end)")
    .eq("vendor_id", vendorId).in("title_id", titleIds);

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
    metadata: metaByTitle.get(t.id) ?? {},
    offer: offerByTitle.get(t.id) ?? [],
  }));

  const { headers, rows } = buildExportRows(spec, inputs);
  const payload = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
  await supabase.rpc("record_export", { p_vendor_id: vendorId, p_title_ids: titleIds, p_payload: payload });

  const buf = await toXlsx(headers, rows, spec.sheet_name ?? "Titles");
  const safeVendor = vendor.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new NextResponse(buf, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${safeVendor}-titles.xlsx"`,
    },
  });
}
```

- [ ] **Step 2: Validate `export_format_spec` in vendor CRUD** (`src/app/gc/vendors/actions.ts`)

Where `saveVendor` currently parses `exportSpecJson` with `parseJsonOrNull`, after confirming it's valid JSON and non-null, also validate the shape:

```ts
import { parseExportSpec } from "@/lib/export-spec";
// … after `if (!spec.ok) return { error: "Export format spec is not valid JSON." };`
if (spec.value !== null) {
  const shape = parseExportSpec(spec.value);
  if (!shape.ok) return { error: `Export format spec invalid: ${shape.error}` };
}
```

- [ ] **Step 3: Export panel** (`src/app/gc/deliveries/export-panel.tsx`, client) — pick endpoint → select its titles → download

```tsx
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";

export type ExportVendor = { id: string; name: string; titles: { id: string; label: string }[] };

export function ExportPanel({ vendors }: { vendors: ExportVendor[] }) {
  const [vendorId, setVendorId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const vendor = vendors.find((v) => v.id === vendorId);
  const sel = "rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink";

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function download() {
    if (!vendorId || selected.size === 0) { setError("Pick an endpoint and at least one title."); return; }
    setBusy(true); setError("");
    const res = await fetch("/api/gc/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vendorId, titleIds: [...selected] }),
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "Export failed."); setBusy(false); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${vendor?.name ?? "export"}-titles.xlsx`; a.click();
    URL.revokeObjectURL(url);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-sm)] border border-hairline bg-surface-muted p-3">
      <span className="t-body font-medium text-ink">Export metadata sheet</span>
      <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setSelected(new Set()); }} className={sel}>
        <option value="">Select endpoint…</option>
        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      {vendor ? (
        <div className="flex flex-col gap-1">
          {vendor.titles.length === 0 ? (
            <span className="t-body-sm text-ink-3">No titles with deliveries to this endpoint.</span>
          ) : vendor.titles.map((t) => (
            <label key={t.id} className="flex items-center gap-2 t-body-sm text-ink-2">
              <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
              {t.label}
            </label>
          ))}
        </div>
      ) : null}
      <Button onClick={download} disabled={busy || !vendorId || selected.size === 0} className="self-start">
        {busy ? "Preparing…" : "Download .xlsx"}
      </Button>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </div>
  );
}
```

- [ ] **Step 4: Mount the panel in `/gc/deliveries`** (`page.tsx`) — build `vendors` (each with the titles that have deliveries to it) from the deliveries already queried, and render `<ExportPanel vendors={exportVendors} />` above the queue list:

```tsx
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
```
(The `deliveries` select must include `vendor_id` and `title_id`; add them to the `.select(...)` if not present.)

- [ ] **Step 5: Typecheck + lint + build** — green; `/api/gc/export` present. Confirm `exceljs` is imported only in the route/engine (server), never a client component.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/gc/export src/app/gc/deliveries/export-panel.tsx src/app/gc/deliveries/page.tsx src/app/gc/vendors/actions.ts
git commit -m "feat(export): GC download route + selection panel + vendor spec validation"
```

---

### Task 5: Verify end-to-end

**Files:** none.

- [ ] **Step 1: Full DB suite** — `supabase test db` → `All tests successful.` (incl. `export_test.sql`).
- [ ] **Step 2: Engine tests** — `npx vitest run` → green.
- [ ] **Step 3: App checks** — `npm run typecheck && npm run lint && npm run build` → green.
- [ ] **Step 4: Leak-check** — invoke `leak-check`; confirm `exceljs` is NOT in the client bundle (server-only import).
- [ ] **Step 5: Manual (founder, GC).** Create pending deliveries for 2 titles to one endpoint; on `/gc/deliveries`, pick the endpoint, select both titles, **Download .xlsx** → the sheet has one row per title with the standard columns + an "Offer" column reading e.g. "SVOD: US, CA"; an `export_records` row is written. Repeat for a vendor with a custom `export_format_spec` → columns follow the spec. Confirm a title missing all required metadata **cannot** be submitted.
- [ ] **Step 6: Commit any fixups** — `git add -A && git commit -m "chore(export): verification fixups"`.

---

## Self-Review

**1. Spec coverage:** `export_records` + `record_export` (append-only snapshot) → Task 1/2 ✓. `submit_title` required gate → Task 1/2 ✓. `export_format_spec` zod schema + standard template → Task 3 ✓. Mapping engine + transforms + offer aggregation + `.xlsx` → Task 3 ✓ (Vitest). Download route (GC-only, records + returns file) → Task 4 ✓. Per-endpoint, one-row-per-title, GC selection → Task 4 ✓. Vendor spec validation → Task 4 ✓. Warnings on blanks/truncation → engine ✓. Seams (asset portal, C-override resolved-view, structured editor) → excluded ✓.

**2. Placeholder scan:** No TBD/TODO. `STANDARD_EXPORT_TEMPLATE` is a working draft (founder-confirmable), not a placeholder — the engine runs against it today. All code complete.

**3. Type consistency:** `record_export(p_vendor_id, p_title_ids, p_payload)` matches the route call. `buildExportRows(spec, titles)` / `TitleExportInput { catalogId, metadata, offer }` / `renderOffer(OfferLine[])` consistent across engine, tests, route. `parseExportSpec` used in both the route and vendor validation. `ExportPanel` props (`vendors: {id,name,titles:{id,label}[]}`) match the page's `exportVendors`. The deliveries select provides `vendor_id`, `title_id`, `vendors(name)`, `titles(title, catalog_id)`.
```
