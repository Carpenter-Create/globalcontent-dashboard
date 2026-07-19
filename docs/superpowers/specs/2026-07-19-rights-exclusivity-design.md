# Rights exclusivity — design (slice B-rights: exclusivity in the carve-out)

> Status: design pending approval. On the rights-grant spine (`rights_grants` + `add_rights_grant`
> + the title-detail intake form) shipped earlier. Source of truth for *what*: `docs/domain-spec.md`
> §9 (rights/territory) + the conflict-prevention model brainstormed 2026-07-19 (see Context).
> This doc is the *how* for **capturing exclusivity only** — the first of four dependency-ordered
> slices that together deliver delivery tracking with cross-client conflict prevention.

## Context

Brainstorming the delivery-tracking slice surfaced a Tier-3 requirement that must exist **before**
deliveries: GC must never distribute in **direct conflict** with a rights holder's exclusive grant.
The founder pinned the rule precisely:

- The same underlying **work** can arrive from more than one client.
- Two clients may hold the **same `rights_type` in the same territory non-exclusively** — both deliver.
- A **direct conflict** exists for (same work, same `rights_type`, overlapping territory) **only if at
  least one of the overlapping claims is exclusive.**

Enforcing that later (soft warning at GC review, hard block at delivery) is impossible unless
exclusivity is **captured at intake, per grant**. Exclusivity "comes down to `rights_type` and
territory together" — which is exactly what a `rights_grant` row already is. So this slice adds
exclusivity to the carve-out and nothing else. It **stores and captures**; it does **not** yet act
on the value.

Dependency-ordered build: **B-rights (this) → B-work (work identity + soft warning) → B-del
(deliveries + hard conflict block) → C (export mapping + market-metadata override).**

## Scope

**In:**
- `rights_grants.exclusive boolean not null` — a per-grant flag (a grant = `rights_type` × territory
  set × window, so one exclusivity per grant).
- `add_rights_grant` gains a **required** `p_exclusive boolean` (no default — "we *have* to ask").
  Applies to every `rights_type` created in that call.
- Intake UI (`add-rights-form.tsx`): an exclusivity control the client must set per add-action.
- Grant display (title-detail rights list): show exclusive / non-exclusive.
- pgTAP: exclusivity persists for `true` and `false`; the flag is required at the RPC boundary.

**Out (seams — later slices):**
- **Work identity** (linking same-work titles at review) — slice B-work.
- **Conflict detection/enforcement** — soft warning at review (B-work), hard block at delivery (B-del).
  This slice does not read `exclusive` anywhere yet.
- **Deliveries** — slice B-del.
- **Market-metadata override** (GC overrides the client logline for market) — slice C.

## Key decisions

- **Exclusivity grain = the grant** (`rights_type` + territory set). No new grain; it rides on the
  existing row. Mixed exclusivity across territories for one `rights_type` (exclusive US, non-exclusive
  CA) is already **separate grants** — the granular model handles it.
- **One exclusivity per add-action**, applied to all `rights_types` selected in that add. Mixed
  exclusivity across `rights_types` in the *same* territory (SVOD exclusive + AVOD non-exclusive) is
  **two adds**. Rationale: the current form multi-selects types against a single territory; a single
  exclusivity choice keeps the UX honest and the RPC a single flag, and the client can still express
  anything via multiple adds. *(Founder sign-off point — per-type exclusivity in one add is possible
  but clunky; deferred unless requested.)*
- **Existing rows default to `false` (non-exclusive).** Safe: a backfilled non-exclusive grant never
  triggers a false future conflict block. New declarations must state exclusivity explicitly (the RPC
  param is required, so the column default only ever applies to pre-existing rows).
- **Capture only, no enforcement.** This slice deliberately does not gate anything on `exclusive`.
  That keeps it small and independently shippable; the value is consumed by B-work and B-del.

## Data model

```sql
alter table public.rights_grants
  add column if not exists exclusive boolean not null default false;
```
- Column comment: exclusivity of this grant's (`rights_type`, territory set). Read by the cross-client
  conflict rule in later slices; unused here.
- No index needed yet (the conflict query in B-work/B-del filters by `title_id`/work + `rights_type`
  first; add an index there if the query plan needs it).
- RLS unchanged — the new column inherits `rights_grants`' existing policies.

## RPC change — `add_rights_grant`

Add a **required** `p_exclusive boolean`. Postgres requires non-defaulted params before defaulted
ones, so `p_exclusive` slots in **before** `p_window_start`:

```
add_rights_grant(
  p_org_id, p_title_id, p_rights_types, p_mode, p_territories,
  p_exclusive       boolean,                 -- NEW, required
  p_window_start    timestamptz default null,
  p_window_end      timestamptz default null,
  p_effective_from  timestamptz default null
) returns uuid[]
```
- The arg-list changes, creating a new overload. **Drop the old `add_rights_grant` signature** and
  create the new one (avoids an ambiguous overload); re-apply the existing `revoke … from public,
  anon` + `grant … to authenticated` for the new signature. *(Destructive op — dropping/replacing a
  function; founder-approved before apply.)*
- Every created grant in the call is inserted with `exclusive = p_exclusive`.
- Regenerate `database.types.ts`; `p_exclusive` becomes a required arg (per the repo's known gotcha:
  no `DEFAULT` ⇒ required in the generated TS).

## Surfaces

- **`add-rights-form.tsx`** — add an exclusivity control (e.g. a two-option toggle "Exclusive /
  Non-exclusive", no default pre-selected so the client must choose, matching "we have to ask"), and
  pass it through `addRights` → `add_rights_grant`. Greyscale affordances (D3).
- **`src/app/(app)/titles/[id]/actions.ts`** (`addRights`) — thread `exclusive` through the zod
  input (`src/lib/rights.ts` helper) and the RPC call.
- **Title-detail rights list** — display exclusive / non-exclusive on each grant so the carve-out is
  legible.

## Verification

- **pgTAP** (extend `rights_grants_test.sql` or add `rights_exclusivity_test.sql`): `add_rights_grant`
  with `p_exclusive => true` persists `exclusive = true`; with `false` persists `false`; grants of
  multiple `rights_types` in one call all carry the same flag.
- `typecheck` / `lint` / `build` green; regenerated types compile (the required param forces callers
  to pass it).
- Manual: on a title, add an **exclusive** SVOD·US grant and a **non-exclusive** AVOD·worldwide grant;
  both appear in the rights list correctly labeled; the form refuses to submit without an exclusivity
  choice.

## Seams left clean

`rights_grants.exclusive` is populated now and consumed by the cross-client conflict rule: the **soft
same-work warning** at the GC review gate (B-work) and the **hard block** in `create_delivery`
(B-del). The rule is: for a linked work, block a new exclusive-involved overlap on (`rights_type`,
territory); allow non-exclusive/non-exclusive overlaps.
