# Metadata-intake slice — design (guided form / path 1, provisional core)

> Status: design pending approval. Fourth product-domain slice, on the org/RLS/provenance
> spine + `titles`. Source of truth for *what*: `docs/domain-spec.md` §12 (intake) + §19
> (findings/health) + §13 (export mapping). This doc is the *how* for path-1 groundwork only.
>
> **Branch note:** written off `main`; implementation must **rebase onto `main` after PR #3
> (asset-upload) merges** — this slice edits `/titles/[id]/page.tsx`, which PR #3 also touched,
> and depends on the systemic membership-scoping fix (`fix(auth): scope … to the caller`) landing.

## Context

Build order: `title stub ✓ → rights grant ✓ → asset upload ✓ → metadata intake (guided form)`.
§12: *"Build the canonical metadata spec first. Fields are tiered: required / recommended /
optional. Required blocks delivery; the rest feed the health score."* Three intake paths are
"three doors into the same room"; **path 1 (guided form) is v1**; paths 2 (template) and 3
(BYO-sheet + AI mapping) are deferred.

**The canonical field spec is "not inventable"** (§12/§21) — it must be the union of what delivery
vendors actually require, and three features depend on it (intake validation, health findings,
export mapping). GC's vendors are **currently unconfirmed** (brand canon), so this slice
deliberately builds **the door, not the final field list** (founder decision — Option B): the
schema-driven *mechanism* against an explicitly **provisional** core, swappable wholesale with zero
schema change when vendor requirements land.

## Scope

**In:**
- `title_metadata` table (one row per title, `data jsonb`) + RLS + audit/updated_at triggers
- **Canonical field registry** (`lib/metadata.ts`) — the single source: tiered field defs + a zod
  schema builder. Drives **both** form rendering and validation.
- Controlled vocabularies: `genre` (provisional list), `language` (ISO 639-1), `country_of_origin`
  (reuses `lib/territories`)
- `set_title_metadata` RPC (SECURITY DEFINER, `operate`-gated, title∈org, upsert)
- Guided-form sub-route `/titles/[id]/metadata` + a completeness summary + "Edit metadata" link on
  the title detail page
- pgTAP + validator sense-checks

**Out (deferred seams):**
- Paths 2 (template download/upload) & 3 (BYO-sheet + AI mapping) — §12
- Findings / health-score queue — §19 (later slice)
- **Delivery-blocking enforcement of required fields** — happens at the delivery/`in_review` gate
  (§12: "required blocks delivery"), not at save here
- Export mapping (canonical → vendor format) — §13 ("one mapping engine," built later)
- The *real* vendor-derived field spec — this ships a provisional core (Option B)

## Decisions (locked)

- **Storage = a `title_metadata` table with a `data jsonb` blob**, validated by the zod canonical
  spec. Not typed columns (a provisional field list would churn migrations) and not a column on
  `titles` (keeps the stub clean; isolates mutable metadata). Swapping the field list later is a
  `lib/metadata.ts` edit — **zero schema change**.
- **The canonical spec lives once, in `lib/metadata.ts`** — a field registry that builds the zod
  schema. Form and validator read the same registry ("AI maps; the validator decides" — §12; the
  validator is deterministic zod).
- **Save validates types + controlled vocab of provided fields but does NOT require required-tier
  fields to be present** — an incomplete draft is savable. Required-completeness is *computed* (for
  the later health score + delivery gate), not enforced at save.
- **Write is an RPC** (`set_title_metadata`), upsert; no client table writes.
- **Mutable + audited:** unlike assets/grants, metadata is client-editable draft data; the
  `audit_log` (via `tg_audit`) records every change (golden rule 5).

## Provisional tiered core (explicitly placeholder — Option B)

Defined in `lib/metadata.ts`; swap wholesale when vendor requirements are confirmed. `title` stays
the stub's `titles.title` — not duplicated here.

| Tier | Fields |
|---|---|
| **Required** | `synopsis` (textarea), `runtime_minutes` (number), `release_year` (number), `genre` (select · vocab), `primary_language` (select · ISO 639-1), `country_of_origin` (select · ISO 3166-1 via `lib/territories`) |
| **Recommended** | `director` (text), `cast` (multiselect/text list), `rating` (select · provisional certification vocab), `keywords` (text list) |
| **Optional** | `alternate_title` (text), `production_company` (text) |

## Data model

```sql
create table title_metadata (
  title_id   uuid primary key references titles(id) on delete restrict,
  org_id     uuid not null references organizations(id) on delete restrict,  -- denormalized for RLS
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
-- index: (org_id)
```

- `title_id` PK = one metadata row per title (upsert). `org_id` denormalized for the RLS predicate
  (kept honest: `set_title_metadata` derives it from the title, never the client).
- RLS SELECT via `member_can(view)`; **writes only through the RPC**. Direct client
  INSERT/UPDATE/DELETE are revoked (hard `42501`) — the RPC is `SECURITY DEFINER` so its upsert is
  unaffected (owner keeps privileges), matching the assets/rights convention. `revoke all … from
  anon`. Audit + updated_at triggers (reuse generics). Mutable *via the RPC* (editable draft data).

## Canonical registry + validation (`lib/metadata.ts`)

```ts
type Tier = "required" | "recommended" | "optional";
type FieldType = "text" | "textarea" | "number" | "select" | "multiselect";
type FieldDef = { key: string; label: string; tier: Tier; type: FieldType; vocab?: readonly string[] };
export const METADATA_FIELDS: FieldDef[] = [ /* the provisional core above */ ];
```
- A builder derives a **zod object schema**: every field **optional** at save (draft-friendly),
  each type-checked (`number`, non-empty string, `enum` for vocab, array for multiselect). Unknown
  keys stripped.
- `requiredComplete(data)` → `{ filled, total }` over the `required` tier (drives the summary +
  later health/delivery gate).
- Vocab: `GENRES` (provisional), `LANGUAGES` (ISO 639-1), country via `lib/territories`
  `ISO_COUNTRIES`. Controlled-vocab values validated by zod `enum`.

## Write path

`set_title_metadata(p_org_id uuid, p_title_id uuid, p_data jsonb) returns void` — SECURITY DEFINER,
`set search_path = public`; raises unless `member_can(auth.uid(), p_org_id, 'operate')` and the
title belongs to the org; `insert … on conflict (title_id) do update set data = p_data,
updated_at = now()`. The server action zod-validates `p_data` against the canonical schema **before**
calling the RPC (the validator decides; the RPC persists).

## UI

- **`/titles/[id]/metadata`** (new sub-route) — a schema-driven guided form: iterate
  `METADATA_FIELDS`, render inputs by `type` (text/textarea/number/select/multiselect), grouped by
  tier with required-tier first. Load current `data`, save via the server action → RPC. Greyscale
  inline errors (D3). Operate-capable roles edit; others get a read-only view.
- **Title detail page** gains a "Metadata — X of N required complete" summary + "Edit metadata"
  link (operate) / "View metadata" (read-only).

## Verification

- **pgTAP `title_metadata_test.sql`:** tenant isolation; `set_title_metadata` capability matrix
  (owner/delivery_ops yes; viewer/legal/accountant raise; GC all-orgs); cross-org title rejected;
  upsert (second call updates, one row); audit row on write.
- **Validator sense-check:** the zod builder accepts a partial draft; rejects a bad type
  (`runtime_minutes: "abc"`) and an out-of-vocab `genre`; strips unknown keys. (Asserted via the
  server-action/RPC path until a JS test runner exists.)
- `typecheck` / `lint` / `build` green; `leak-check` (no new secrets); manual: fill a partial draft
  → save → reload persists → completeness summary updates.

## Seams left clean

`lib/metadata.ts` is the single field spec that paths 2/3, the health score, and the export mapping
(§13) will all read. `title_metadata.data` is delivery-gate-ready (`requiredComplete`). Swapping the
provisional core for the vendor-derived spec is a `lib/metadata.ts` edit — no migration.
