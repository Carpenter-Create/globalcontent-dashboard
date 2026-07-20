# Export mapping — design (slice C-export)

> Status: design pending approval. First consumer of `vendors.export_format_spec` and `title_metadata`.
> Source of truth for *what*: `docs/domain-spec.md` §13 (export = intake in reverse, one engine) + §19
> (the spec powers vendor health checks) + the export workflow brainstormed 2026-07-19. This doc is the
> *how* for the **metadata export sheet** — the GC-facing delivery-prep output.

## Context

GC sales agents pitch titles to endpoints **by hand via their own Gmail** — the app never contacts an
endpoint. The app's job here is **delivery prep**: produce a one-click, endpoint-formatted **`.xlsx`
metadata sheet** the agent attaches to their email. This slice defines the mapping (`export_format_spec`),
the deterministic engine that applies it (canonical `title_metadata` → the endpoint's columns), a GC
download route, and an append-only **export audit log**. Metadata-only — asset download links are a
later slice (they need CloudFront/S3-GET signing that doesn't exist yet).

Reuse constraint (§13/§19): `export_format_spec` is the **same** artifact that later powers vendor-specific
health checks (e.g. "synopsis over this endpoint's character cap"), so its schema — including per-column
`max_length` — is designed once, here.

## Scope

**In:**
- A typed **`export_format_spec` schema** (zod) — a template: ordered columns, each with a source
  (canonical field / catalog_id / aggregated offer / static), an optional bounded **transform**, and an
  optional **`max_length`** (which doubles as the §19 cap).
- A **Global Content standard template** (the default when a vendor has no spec) — a fillable config.
- The **mapping engine** (pure lib): resolve template → per selected title, build a row → apply
  transforms → truncate → serialize to `.xlsx` (via `exceljs`, server-side). Deterministic; unit-tested.
- **Export grain: one sheet per endpoint, one row per title** (GC selects which titles); each row's offer
  is the title's deliveries to that endpoint **aggregated** (rights · territories · window).
- A **GC download route** (`is_gc_staff`) returning the `.xlsx` as an attachment.
- An append-only **export audit record** snapshotting who/when/which endpoint/which titles + the exported
  row payload.
- Shore up the **required-metadata submission gate** in `submit_title` (currently missing) so deliverable
  titles always have required fields.
- Validate `vendors.export_format_spec` against the new schema in the vendor CRUD (still JSON-edited v1).

**Out (seams):**
- **Asset download links / access portal** (screener view at pitch, master download at delivery; OTP-gated,
  branded, audited) — the next slice; needs signing + transactional-email + branded gateway infra.
- **Structured spec editor** (drag/drop column mapping) — fast-follow; v1 edits validated JSON.
- **Market-metadata override (C-override)** — next; the engine reads a *resolved* metadata view so it slots
  in without rework.
- **Expanding the canonical metadata model** — endpoint columns we don't collect render blank (warned) or
  static; GC fills the rest by hand. Full technical delivery metadata is a separate, larger effort.
- **Non-xlsx formats, localization/per-language metadata.**

## Key decisions (from the design dialogue)

- **App prepares, GC delivers; the app never contacts an endpoint.** Export is the single universal output
  for every vendor. (Retires the old "email send" slice.)
- **`.xlsx`** output (founder-chosen), via a maintained lib (`exceljs` — not the SheetJS `xlsx` package,
  which has had supply-chain concerns). Server-side only.
- **Template resolution:** vendor `export_format_spec` if present, else the **GC standard template**. GC can
  also pick the endpoint/template deliberately at download.
- **Grain: per-endpoint sheet, one row per title, offer aggregated** across that title's deliveries to the
  endpoint. GC selects the titles. Status is *not* a sheet column (it's a pitch doc).
- **Include the commercial offer** (rights type · territory · window) per title.
- **Bounded transform set (v1):** `none | number_format | date_format | list_join | enum_map | truncate`.
  Anything outside this won't map. `max_length`/`truncate` cap = the §19 limit.
- **Log every export as a snapshot** — the exported row values + who/what/when/endpoint — append-only
  (provenance: this is what GC represented to the endpoint).
- **Required-metadata is guaranteed** for deliverable titles because `submit_title` will block submission
  when required fields are missing; export still **warns** on optional/vendor-specific gaps.
- **Fields we don't collect:** map what we have + static values; blanks are warned, never invented.

## Data model

### `export_format_spec` (zod schema, validates the jsonb; also the standard-template shape)

```ts
// src/lib/export-spec.ts (new)
type TransformType = "none" | "number_format" | "date_format" | "list_join" | "enum_map" | "truncate";
type ExportColumn = {
  header: string;                       // the endpoint's column label
  source:
    | { kind: "field"; key: CanonicalFieldKey }   // from METADATA_FIELDS (src/lib/metadata.ts)
    | { kind: "catalog_id" }                       // titles.catalog_id
    | { kind: "offer" }                            // aggregated rights·territory·window for this endpoint
    | { kind: "static"; value: string };
  transform?:
    | { type: "none" }
    | { type: "number_format"; pattern?: string }
    | { type: "date_format"; pattern: string }
    | { type: "list_join"; delimiter: string }
    | { type: "enum_map"; map: Record<string, string> }
    | { type: "truncate"; max: number };
  max_length?: number;                  // v1 export cap; later the §19 health-check limit
};
type ExportFormatSpec = { format: "xlsx"; sheet_name?: string; columns: ExportColumn[] };
```
- A zod parser (`parseExportSpec`) validates `vendors.export_format_spec`; the vendor CRUD rejects an
  invalid spec (upgrades today's JSON-only validation).
- The **standard template** is a `STANDARD_EXPORT_TEMPLATE: ExportFormatSpec` constant in the same lib —
  **founder to supply the exact column list**; a draft (catalog_id, title, synopsis, runtime, year, genre,
  language, country, director, cast, rating, + offer) is proposed for sign-off.

### `export_records` (append-only audit snapshot)

```sql
create table public.export_records (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references public.vendors(id) on delete restrict,
  title_ids    uuid[] not null,
  payload      jsonb not null,          -- the exact rows exported (snapshot of what GC sent)
  exported_by  uuid references auth.users(id),
  exported_at  timestamptz not null default now()
);
```
- RLS: `is_gc_staff` SELECT; `revoke insert/update/delete from authenticated, service_role` — written only
  via a SECURITY DEFINER RPC `record_export(...)`; immutable (no update/delete). `revoke all from anon`.
- Provenance record of every export (who/when/endpoint/titles + the snapshotted rows).

### `submit_title` change (required-metadata gate)

Replace `submit_title` to raise unless the title's `title_metadata.data` has non-empty values for every
**required** canonical key (`synopsis, runtime_minutes, release_year, genre, primary_language,
country_of_origin` — the REQUIRED tier in `src/lib/metadata.ts`; the SQL lists them with a comment naming
that source of truth). Keeps the client from turning in an incomplete title.

## Mapping engine (pure lib — `src/lib/export-engine.ts`)

`buildExportRows(spec, titles[])` where each `title` = `{ metadata, catalog_id, offer }` →
`{ headers: string[], rows: string[][], warnings: string[] }`:
- For each column, resolve `source` → raw value (field lookup / catalog_id / rendered offer / static).
- Apply `transform` (bounded set); apply `max_length` truncation (record a warning if truncated).
- Missing value for a column → blank cell + a warning (never invents data).
- Deterministic and side-effect-free → unit-tested with Vitest.
`toXlsx(headers, rows, sheetName)` serializes via `exceljs` (server-side) → a Buffer.

**Offer aggregation:** for a title's deliveries to the endpoint, group by `rights_type`, list territories,
note window → a readable string (e.g. `SVOD: US, CA (through 2027) · AVOD: Worldwide`). Rendered by the
engine; the column just sources `{ kind: "offer" }`.

## Download route + selection surface

- **Route** `src/app/api/gc/export/route.ts` (GET with query, or POST) — `is_gc_staff` gate; input =
  `vendor_id` + `title_ids[]`; runs under the GC session (GC RLS reads vendors + all orgs' metadata/
  deliveries). Gathers metadata + aggregated offers, resolves the template (vendor spec ∥ standard),
  calls the engine, calls `record_export`, returns the `.xlsx` with
  `content-disposition: attachment; filename="<endpoint>-<date>.xlsx"` (mirrors the agreements route).
- **Selection UI** on `/gc/deliveries`: pick an endpoint → see its titles (those with deliveries to it) →
  select → "Download sheet". Warnings (blanks/truncations) shown before/after download.

## Verification

- **Vitest (engine):** transforms (each type), truncation + warning, missing-value blank + warning, offer
  aggregation, standard-vs-vendor template resolution, header/row shape. (Pure lib — the natural test home.)
- **pgTAP:** `submit_title` blocks on missing required metadata, passes when complete; `record_export` is
  GC-only + append-only (update/delete revoked) + RLS; `export_records` tenant/GC read rules.
- `parseExportSpec` zod tests (valid/invalid specs).
- `typecheck`/`lint`/`build` green; leak-check; manual: GC selects an endpoint + titles → downloads a
  correct `.xlsx` (standard template, and a vendor with a custom spec) → an `export_records` row is written.

## Seams left clean

The engine reads a **resolved** metadata view so C-override (GC market metadata) layers in without rework.
`export_format_spec` + `max_length` are the exact inputs §19 health checks will read. The download route is
the pattern the asset-access portal extends (adding signing + OTP gate). `record_export` is the provenance
spine for "what did we send this endpoint."
