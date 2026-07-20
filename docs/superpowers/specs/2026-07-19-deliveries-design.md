# Delivery tracking — design (slice B-del)

> Status: design pending approval. The payoff slice of the delivery area — consumes vendors (A),
> exclusivity (B-rights), catalog-id, and work-identity (B-work). Source of truth for *what*:
> `docs/domain-spec.md` §13 (delivery is manual, person-set) + the delivery model brainstormed
> 2026-07-19. This doc is the *how* for delivery tracking.

## Context

GC places a client's title on distribution partners **by hand** — there are no platform APIs (§13).
Each placement is one **delivery**: `title × vendor(endpoint) × territory`, authorized by a specific
rights **grant**. Both GC and the client need to see where each placement sits in the pipeline. This
slice builds the `deliveries` table, the GC-only write RPCs (with rule-12 + cross-client conflict
enforcement), the GC master queue, and the client's read-only per-vendor view. It is the first
consumer of B-work's `territories_overlap` + same-work conflict logic and of `can_deliver`.

## Scope

**In:**
- `delivery_status` enum: `pending | delivered | live | rejected | taken_down`.
- `deliveries` table: `title × vendor × territory × grant`, org-denormalized, status, audit/updated_at.
- RLS: SELECT for the owning org **or** `is_gc_staff`; **no direct writes** (revoked) — RPC-only.
- `create_delivery` RPC (SECURITY DEFINER, `is_gc_staff`): enforces rule 12 (`can_deliver`) **and** the
  hard cross-client exclusive-conflict block (reusing `territories_overlap`), inside the RPC.
- `set_delivery_status` RPC (SECURITY DEFINER, `is_gc_staff`): advances status; audit-logged.
- `my_deliveries` read function (SECURITY DEFINER): the client's own deliveries + vendor names, without
  loosening vendors' GC-only RLS.
- GC master queue `/gc/deliveries` (cross-org: create + advance).
- Client per-vendor read view filling `/deliveries` — only endpoints the title was sent to; clean
  business statuses only.
- Derived **title "Live" rollup** (≥1 delivery live) with an "N of M platforms" indicator — computed,
  not stored.
- pgTAP + app checks.

**Out (seams):**
- **`restoring` / Glacier** — a backend state, deferred to the cold-storage slice (E); never
  client-facing when it lands.
- **Export mapping (C)** and **email send / auto-`delivered` (D)** — for now every status is set by hand.
- **Revenue↔live mismatch flag** — a finding for the revenue module (a platform paying for a title not
  marked live); noted, not built.
- **Mutating `title.status` to `live`** — the title lifecycle stays `in_delivery`; "Live" is derived.

## Key decisions (from the design dialogue)

- **Status is set by a person, logged — no platform APIs.** The system cannot detect "live on Hulu/
  Tubi/Angel"; GC confirms and marks it (one click), and `audit_log` (who/when) is the provenance
  record (§13). Automatic marking is possible only for in-system actions later (auto-`delivered` when
  GC emails a vendor from the dashboard — slice D).
- **No `restoring` status.** It's an Amazon Glacier retrieval concept — backend plumbing, deferred, and
  never something a client should see. The archived-master case is handled with the Glacier slice as an
  *asset-availability* condition; a delivery simply waits at `pending` until the file is ready.
- **Client sees only endpoints their title was actually sent to**, and only **business-meaningful**
  statuses. GC-internal/operational states (future: retrieval, QC holds) stay GC-side and map to a clean
  client label — the client never sees backend machinery.
- **Title "Live" is a derived rollup, not a stored flip.** Shown when ≥1 of the title's deliveries is
  `live`; auto-clears if the last live platform is taken down (no sweep, no stale badge — same
  derive-don't-duplicate principle as the conflict warning). The client sees "Live" the moment the film
  is live *somewhere*, with a per-platform breakdown.
- **Title status labels (client-facing vocabulary — founder-decided).** The *title* lifecycle is
  relabeled: `in_review` → **"In review"** (client turned it in; GC reviewing for approval),
  `in_delivery` → **"Submitted"** (GC approved it — in the distribution process), with the derived
  **"Live"** rollup shown on top once a platform goes live. This is a **label change only** — the
  internal enum is unchanged (approval already lands on `in_delivery`). B-del folds it in and
  **centralizes the title-status label map** (today duplicated in the titles pages) so title detail,
  the titles list, and `/gc/review` all read the same. The **delivery** statuses are unchanged
  (`pending`/`delivered`/`live`/`rejected`/`taken_down`).
- **Enforcement is in-RPC, not a trigger.** The repo has no constraint-trigger precedent; every
  invariant is a `raise exception` inside the SECURITY DEFINER RPC, with direct table writes revoked —
  which *is* database-level enforcement (rule 12) because the RPC is the only write path.
- **`can_deliver` is called inside `create_delivery`** (SECURITY DEFINER runs as owner, unaffected by
  the hardening-migration revoke) — no re-grant to `authenticated`.
- **The hard conflict block reuses `territories_overlap`** — one overlap definition shared with B-work.

## Data model

```sql
create type public.delivery_status as enum ('pending','delivered','live','rejected','taken_down');

create table public.deliveries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete restrict,  -- denormalized from title, for RLS
  title_id     uuid not null references public.titles(id)        on delete restrict,
  vendor_id    uuid not null references public.vendors(id)        on delete restrict,
  grant_id     uuid not null references public.rights_grants(id)  on delete restrict,  -- authorizing grant (carries rights_type)
  territory    text not null,                    -- single resolved ISO alpha-2 (one storefront)
  status       public.delivery_status not null default 'pending',
  status_note  text,                             -- optional GC note on the current status
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint deliveries_territory_iso_chk check (territory ~ '^[A-Z]{2}$'),
  unique (title_id, vendor_id, territory, grant_id)   -- one listing per storefront per grant
);
-- indexes: (org_id), (title_id), (vendor_id), (grant_id), (status)
-- triggers: tg_audit (provenance — §13: audit_log IS the delivery-status record), tg_set_updated_at
```
- **RLS:** `deliveries_select using (public.is_gc_staff(auth.uid()) or public.member_can(auth.uid(), org_id, 'view'))` — GC reads all orgs, a client reads its own. `revoke insert, update, delete from authenticated, service_role` — RPC-only writes. `revoke all from anon`.
- `grant_id` FK anchors provenance (rights_type + scope + window read through the grant); `org_id`
  denormalized from the title (set by the RPC) for tenant isolation without a join.

## Enforcement — the write RPCs (SECURITY DEFINER, `is_gc_staff`)

**`create_delivery(p_title_id, p_vendor_id, p_grant_id, p_territory) returns uuid`**
1. `is_gc_staff` gate; else raise.
2. The grant belongs to the title, is active, and its rights_type/scope/window cover `p_territory` **at
   now()** — via `can_deliver(p_title_id, <grant.rights_type>, p_territory, now())` (called inside the
   definer RPC) **and** confirming `grant.title_id = p_title_id`. Else raise (rule 12).
3. **Hard conflict block:** if the title is linked to a work and another org holds an **active grant on
   the same work**, same `rights_type`, territory overlapping `p_territory`, with **an exclusive claim
   involved** → raise (would create a conflicting exclusive placement). Reuses `territories_overlap`;
   runs as owner so it sees all orgs.
4. Insert at `status = 'pending'`, `org_id` from the title, `created_by = auth.uid()`. Return id.

**`set_delivery_status(p_delivery_id, p_status, p_note) returns void`** — `is_gc_staff` gate; update
status + note; audit trigger records who/when. (Forward transitions are GC's judgment; no state machine
enforced beyond the enum this slice.)

## Client vendor visibility

Clients can't read `vendors` (GC-only RLS). **`my_deliveries() returns table(...)`** — SECURITY
DEFINER, returns the caller's own org deliveries joined to vendor **name** + delivery fields (status,
territory, title). Definer bypasses vendors' RLS but returns only the caller's rows (filtered by
`member_can(auth.uid(), org_id, 'view')` inside), so no vendor data leaks beyond names on the client's
own deliveries.

## Derived title "Live" rollup

A read (query or small function): a title shows **Live** when `exists (delivery where status='live')`;
the indicator is `count(status='live') of count(*)` → "Live · N of M platforms". Computed on read on
the title detail (client sees their own). `title.status` is **not** mutated.

## Surfaces

- **`/gc/deliveries`** (GC, cross-org): list all deliveries (filter by status/vendor/title/org); a
  create form (pick title → vendor → territory → the covering grant) calling `create_delivery`; a
  status control per row calling `set_delivery_status`. Greyscale (D3). Add to the GC nav.
- **`/deliveries`** (client, fills the placeholder): read-only, grouped per vendor/endpoint, showing
  only the client's deliveries (status + territory) via `my_deliveries`. Clean statuses only.
- **Title detail** (client): the derived "Live · N of M" rollup + per-platform status list for that
  title; the title's own status shown with the corrected labels (**In review / Submitted / Live**), from
  the centralized label map.

## Verification

- **pgTAP:** `create_delivery` — GC creates a valid delivery; client denied (`is_gc_staff`); rule-12
  refusal (no covering grant / territory outside grant / expired window); **hard conflict block**
  (another org's exclusive same-work overlap refuses; two non-exclusive coexist); `set_delivery_status`
  advances + is GC-only; tenant isolation (client reads own deliveries, not another org's);
  `my_deliveries` returns the caller's rows + vendor names and nothing cross-org; derived "live" rollup
  query correctness.
- `typecheck` / `lint` / `build` green; leak-check; manual (GC creates deliveries across two orgs,
  advances to Live; client sees per-vendor status + the "Live · N of M" rollup; a cross-client exclusive
  conflict is refused at create).

## Seams left clean

`territories_overlap` + the conflict predicate are shared with B-work (one definition). `grant_id` +
`status` are what the export (C) and email (D) slices read to build vendor payloads and auto-advance
`delivered`. The revenue module reads deliveries to flag live↔revenue mismatches. Glacier (E) adds an
asset-availability gate that holds a delivery at `pending`. `title.status → live` stays derived.
