# Rights-grants slice — design (groundwork)

> Status: design pending approval. Second product-domain slice, on the proven
> org/RLS/provenance spine and the `titles` table. Source of truth for *what*:
> `docs/domain-spec.md` §9 (rights & territory) + golden rule 12. This doc is the
> *how* for the groundwork only.

## Context

The build order is `title stub → rights grant → asset upload`. Titles shipped (name-only
stub, `title_status`, RLS, `create_title`). This slice adds the **rights grant** — per §9,
*"the single largest structural element … a first-class, effective-dated, per-title entity,
and delivery is gated by them."* Golden rule 12: **grants expand, never contract**;
territories are **resolved ISO codes, never labels**; **no delivery may exist outside an
active grant's scope and window — enforced in the database, not the UI.**

This slice lays the **structural groundwork**: the grant model, the expand-only write path,
territory resolution, and the DB delivery-gate function — all provable now by pgTAP. Two
things §9 leans on don't exist yet and stay clean seams: **deliveries** (the thing gated) and
the **money path** (the `$97` rights-change fee).

## Scope

**In:**
- `rights_type` enum (21 values, §9 taxonomy) + `territory_mode` enum (`world|include|exclude`)
- `rights_grants` table (immutable) + indexes + RLS + audit/updated_at triggers
- Territory resolver (`lib/territories.ts`): label selections → resolved ISO 3166-1 alpha-2
- `lib/rights.ts`: rights-type metadata (category, label, description, examples) for the UI
- `add_rights_grant` RPC (the single write path; expand = insert, `operate`-gated)
- `can_deliver(title, rights_type, territory, at)` SECURITY DEFINER gate function
- Minimal UI: grants listed on a title + an add/expand form
- pgTAP: tenant isolation, expand-only enforcement, the gate matrix, territory resolution

**Out (seams):**
- Deliveries (the `title × vendor × territory` consumer of `can_deliver`)
- `$97` rights-change fee + `$197` early-takedown (fees table §7 + Stripe fee-charge, rule 10)
- Full territory-picker UX polish (this slice ships a functional, not designer-grade, picker)
- Rights types beyond the seed 21 (add later via one-line enum migration + `lib/rights.ts` entry)
- Takedown / resubmit flow (the "want less scope" path, §9) — future slice

## The rights-type taxonomy (locked; founder-supplied)

`rights_type` enum values, grouped by category for the UI (grouping lives in `lib/rights.ts`,
not the DB):

| Category | codes |
|---|---|
| Theatrical | `theatrical` |
| Television | `fta`, `basic_cable`, `pay_tv`, `dth_satellite`, `ppv` |
| Video-on-Demand | `pvod`, `svod`, `hvod`, `tvod`, `est`, `avod`, `fast`, `fvod`, `bvod` |
| Out-of-Home & Institutional | `non_theatrical`, `hospitality`, `edu`, `ppl` |
| Physical Media | `home_video`, `mod` |

`rights_type` is a Postgres enum (like `org_role`, `title_status`) — type-safe, RLS-friendly,
migration-gated (adding a rights-bearing type should be a deliberate act). Category / label /
description / examples are presentation and live in `lib/rights.ts`.

## Data model — append-only union (the heart of rule 12)

```sql
create table rights_grants (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete restrict,
  title_id       uuid not null references titles(id)        on delete restrict,
  rights_type    rights_type_enum   not null,
  territory_mode territory_mode_enum not null,       -- world | include | exclude
  territories    text[] not null default '{}',       -- resolved ISO alpha-2; [] when mode=world
  window_start   timestamptz,                         -- holdback start; null = immediate
  window_end     timestamptz,                         -- null = end of term
  effective_from timestamptz not null,                -- grant-event timestamp, never now() blindly
  effective_to   timestamptz,                         -- NATURAL end only (term expiry); null = active
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
-- indexes: (org_id), (title_id), (title_id, rights_type)
-- CHECK: territory_mode='world' => territories = '{}'; else array_length >= 1
-- CHECK: window_end is null or window_start is null or window_end > window_start
```

**Immutable rows** (like `source_records`): no UPDATE, no DELETE — both revoked from
`authenticated`/`service_role`. Every grant is a permanent, append-only fact.

**Expand-never-contract is enforced by construction, not by a check.** The effective rights
for a `(title, rights_type)` are the **union of its active grant rows** (`effective_to is
null`). The only write is *insert a grant row*, and a union can only ever **grow** when you
add to it — so:

- **Expand** = insert another grant row (a wider territory, a new rights_type, an extended
  window). Coverage increases.
- **Contract is inexpressible.** There is no operation that removes a country, narrows a
  window, or deletes a grant — so scope cannot shrink. This is a *stronger* guarantee than a
  superset-validation check (which can have edge-case bugs): the append-only structure makes
  shrinking impossible, matching §9 exactly. Less scope = takedown + resubmit (future slice).
- `effective_to` is stamped **only** by a natural end (term expiry — a later system-initiated
  path), never by client action, and never to shrink live scope.

> **Correction of an over-grant** (granted more than intended) is the one case shrinking would
> be needed — and §9 forbids it (GC holds the rights for the term; unilateral shrink is a
> breach). A genuine data-entry error is a break-glass owner/`postgres` fix, audit-logged —
> the same posture as every other immutable table. Not a client write path.

## Territory resolution (`lib/territories.ts`)

UI offers **world / continent / country**; **resolve to explicit ISO alpha-2 at grant time**
(§9: "Europe" shifts, store codes). The resolver holds a fixed continent→ISO map and the
ISO country list. `mode` + list expresses "worldwide except UK" (`exclude`, `['GB']`).
Resolution happens server-side in the RPC input path (zod-validated alpha-2), never trusting
client-sent country sets blindly.

## The delivery gate (`can_deliver`) — rule 12, enforced in the DB

```
can_deliver(p_title uuid, p_rights_type rights_type_enum, p_territory text, p_at timestamptz)
  returns boolean   -- SECURITY DEFINER, stable
```
True iff an **active** grant (`effective_to is null`) for `(title, rights_type)` covers
`p_territory` (per `mode`+`territories`) **and** `p_at` ∈ window (`window_start`..`window_end`,
nulls = open). This is the function the deliveries slice will call before creating any
`title × vendor × territory` row. Built and pgTAP'd now against grant rows directly — rule 12
is proven before deliveries exist.

## Write path (one RPC, SECURITY DEFINER, `operate`-gated — Delivery Ops/Owner, §4)

Because expand = insert (union grows) and contract is inexpressible, there is **one write**:

- `add_rights_grant(p_org, p_title, p_rights_types[], p_mode, p_territories[], p_window_start, p_window_end, p_effective_from)`
  → validates capability (`member_can(..., 'operate')`) + title belongs to org + resolved ISO
  codes (zod at the edge, re-checked in the RPC); inserts **one row per rights_type**; returns
  the created ids. Both the initial grant (at title submit) and a later expansion use this same
  call — "create" vs "expand" is a **billing distinction derived later** (any grant added
  after the initial submit is the `$97` rights-change event), not a separate write path.

No client-side table writes (mirrors `create_title`). `effective_from` comes from the event
timestamp passed in, per rule 8 — for this slice's manual entry that's the submission time,
not a blind `now()`. The `$97` fee is a seam (fees table + Stripe, later slice).

## RLS

- SELECT: `member_can(auth.uid(), org_id, 'view')`
- INSERT/UPDATE/DELETE: none for clients — writes go through the RPCs; UPDATE/DELETE revoked
  (immutable). `revoke all … from anon`.

## Provenance

Manual grant entry → the `audit_log` (via `tg_audit`) is the provenance record (golden rule 5).
`effective_from`/`created_by` plus the append-only row history make the widening sequence
reconstructable. No `source_documents` row for a manually-entered grant.

## UI (minimal)

On a title's detail surface: list active grants (rights type by category, territory summary,
window) and an **Add rights** form (multi-select rights types + territory picker → resolved
codes). "Expanding" is just adding another grant — no separate edit affordance, because
scope only ever grows. Greyscale inline errors (divergence D3). Operate-capable roles only.

> Note: titles have no detail page yet (the titles slice shipped list + create only). This
> slice adds a minimal title detail route (`/titles/[id]`) to host the grants surface.

## Verification

- **pgTAP `rights_grants_test.sql`:** tenant isolation; `add_rights_grant` capability matrix
  (owner/delivery_ops yes; viewer/legal/accountant raise; GC all-orgs); **immutability —
  UPDATE and DELETE both raise** (this *is* the expand-never-contract guarantee: no write can
  shrink); union semantics (two active grants → coverage is their union); `can_deliver` truth
  matrix (in/out of territory under each mode incl. `exclude`; before/after/inside window;
  expired grant `effective_to < now` excluded; wrong rights_type excluded).
- **Territory resolver unit** (once a JS test runner exists — else assert via the RPC path):
  world→[], continent→ISO set, exclude semantics.
- `typecheck` / `lint` / `build` green; `leak-check` pass; manual browser: add + expand a grant.

## Seams left clean

`can_deliver` is the single call site deliveries will use. `rights_type`/territory model is
delivery-ready (`title × vendor × territory`). Fee hooks (`$97` expand, `$197` takedown) are
named but unbuilt. Takedown/resubmit is a future slice.
