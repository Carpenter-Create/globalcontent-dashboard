# Rights-grants (groundwork) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `rights_grants` domain layer — an append-only, expand-never-contract grant model with ISO-resolved territories, a single write RPC, and a DB delivery-gate — on top of the existing `titles` table.

**Architecture:** One migration ships the enums + `rights_grants` table (immutable, RLS-scoped by `member_can`) + `add_rights_grant` RPC + `can_deliver` gate, mirroring the titles migration. Expand-never-contract is enforced *by construction*: grants are insert-only, effective scope is the union of active rows, so scope can only grow. Territory selections resolve to ISO alpha-2 in a `lib/` module before hitting the RPC. A minimal `/titles/[id]` detail route hosts the grants UI.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase Postgres (SECURITY DEFINER RPCs, RLS, pgTAP), TypeScript strict, Tailwind + GC tokens.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-18-rights-grants-design.md`. Domain source of truth: `docs/domain-spec.md` §9 + golden rule 12.
- **RLS is the authorization boundary** — every table ships SELECT policy via `member_can()`; writes only through SECURITY DEFINER RPCs; no client table writes. (`rls-data-layer`)
- **Nothing is deleted; sources immutable** — `rights_grants` has no UPDATE/DELETE (revoked). Corrections are new rows.
- **Grants expand, never contract** (rule 12) — enforced by construction (insert-only union), not a superset check.
- **Territories are resolved ISO 3166-1 alpha-2, never labels** — `mode` (`world|include|exclude`) + explicit list.
- **Money is a seam** — `$97` rights-change and `$197` takedown are NOT built here (no Stripe/fees).
- **Provenance** — `audit_log` via existing `tg_audit()` trigger is the record for manual grant entry (golden rule 5).
- **Destructive-ops rule** — the migration creates triggers + revokes UPDATE/DELETE; show exact SQL and get explicit approval before `supabase migration up`.
- **Migration filename:** `supabase/migrations/20260718000200_rights_grants.sql` (after `20260718000100_titles.sql`).
- **Conventions:** UUID PKs, `timestamptz`, `snake_case`, TS strict, zod at the edge; regenerate `database.types.ts` after the migration (strip leaked CLI stdout lines — see Task 3).
- **Voice/design:** greyscale inline errors only (no red — divergence D3); design tokens only.

---

### Task 1: Migration — enums, `rights_grants` table, RLS, triggers, `add_rights_grant` RPC, `can_deliver` gate

**Files:**
- Create: `supabase/migrations/20260718000200_rights_grants.sql`

**Interfaces:**
- Consumes: `public.organizations`, `public.titles`, `public.member_can(uuid,uuid,text)`, `public.is_gc_staff(uuid)`, `public.tg_audit()`, `public.tg_set_updated_at()` (all from prior migrations).
- Produces:
  - enums `public.rights_type` (21 values), `public.territory_mode` (`world|include|exclude`)
  - table `public.rights_grants`
  - `public.add_rights_grant(p_org_id uuid, p_title_id uuid, p_rights_types public.rights_type[], p_mode public.territory_mode, p_territories text[], p_window_start timestamptz, p_window_end timestamptz, p_effective_from timestamptz) returns uuid[]`
  - `public.can_deliver(p_title_id uuid, p_rights_type public.rights_type, p_territory text, p_at timestamptz) returns boolean`

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================================
-- 20260718000200_rights_grants.sql
--
-- INTENT: The rights-grant layer (domain-spec §9, golden rule 12) — the second
-- product-domain table, on the titles table + org/RLS/provenance spine.
-- "Rights are a first-class, effective-dated, per-title entity, and delivery is
-- gated by them." Grants EXPAND, never CONTRACT — enforced by construction:
-- rows are insert-only, effective scope is the union of active rows, a union
-- only grows. There is no write that shrinks scope.
--
-- Ships complete (mirrors the titles/init migrations):
--   1. enums (rights_type [21 values], territory_mode)
--   2. table (rights_grants) + indexes + CHECK constraints
--   3. triggers (audit + updated_at — reuse generic functions)
--   4. RLS (SELECT via member_can; no client writes; UPDATE/DELETE revoked)
--   5. add_rights_grant RPC (single write path; expand = insert)
--   6. can_deliver gate (rule 12 — enforced in the DB, tested now)
--
-- DELIBERATELY EXCLUDED (seams, later slices): deliveries (the can_deliver
-- consumer), $97 rights-change + $197 takedown fees (fees table + Stripe),
-- takedown/resubmit flow, rights types beyond the seed 21.
--
-- DESTRUCTIVE OPS (per repo rule — approved before apply):
--   - trigger creation on rights_grants
--   - REVOKE UPDATE, DELETE on rights_grants (immutability)
-- Forward-only + idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUMS
-- ----------------------------------------------------------------------------
-- rights_type: the §9 taxonomy (founder-supplied). Category grouping is
-- presentation and lives in lib/rights.ts, not the DB. Adding a value later is a
-- deliberate migration (rights-bearing).
do $$ begin
  create type public.rights_type as enum (
    'theatrical',
    'fta','basic_cable','pay_tv','dth_satellite','ppv',
    'pvod','svod','hvod','tvod','est','avod','fast','fvod','bvod',
    'non_theatrical','hospitality','edu','ppl',
    'home_video','mod'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.territory_mode as enum ('world','include','exclude');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. TABLE
-- ----------------------------------------------------------------------------
-- rights_grants — immutable, append-only, per-title. Org-owned (RESTRICT):
-- never cascades on user deletion (§11). territories are resolved ISO alpha-2.
create table if not exists public.rights_grants (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete restrict,
  title_id       uuid not null references public.titles(id)        on delete restrict,
  rights_type    public.rights_type    not null,
  territory_mode public.territory_mode not null,
  territories    text[] not null default '{}',   -- resolved ISO alpha-2; '{}' when mode=world
  window_start   timestamptz,                     -- holdback start; null = immediate
  window_end     timestamptz,                     -- null = end of term
  effective_from timestamptz not null,            -- grant-event time (rule 8), never blind now()
  effective_to   timestamptz,                     -- NATURAL end only (term expiry); null = active
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint rights_grants_world_empty_chk check (
    (territory_mode = 'world' and territories = '{}')
    or (territory_mode <> 'world' and array_length(territories, 1) >= 1)
  ),
  constraint rights_grants_window_chk check (
    window_end is null or window_start is null or window_end > window_start
  )
);
create index if not exists rights_grants_org_idx        on public.rights_grants (org_id);
create index if not exists rights_grants_title_idx      on public.rights_grants (title_id);
create index if not exists rights_grants_title_type_idx on public.rights_grants (title_id, rights_type);

-- ----------------------------------------------------------------------------
-- 3. TRIGGERS — reuse the generic audit + updated_at functions
-- ----------------------------------------------------------------------------
drop trigger if exists audit_rights_grants on public.rights_grants;
create trigger audit_rights_grants after insert or update or delete on public.rights_grants
  for each row execute function public.tg_audit();

drop trigger if exists set_updated_at_rights_grants on public.rights_grants;
create trigger set_updated_at_rights_grants before update on public.rights_grants
  for each row execute function public.tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. RLS — SELECT via member_can; no client write path; immutable
-- ----------------------------------------------------------------------------
alter table public.rights_grants enable row level security;
revoke all on public.rights_grants from anon;

drop policy if exists rights_grants_select on public.rights_grants;
create policy rights_grants_select on public.rights_grants for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));
-- INSERT: only via add_rights_grant() RPC. UPDATE/DELETE: none + revoked below.

revoke update, delete on public.rights_grants from authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. WRITE PATH — add_rights_grant (expand = insert; one row per rights_type)
-- ----------------------------------------------------------------------------
-- Capability-gated (operate = account_owner|delivery_ops, §4). Verifies the
-- title belongs to the org. Inserts one immutable row per rights_type; returns
-- their ids. "Create" vs "expand" is a later billing distinction, not a
-- different write. Contraction is inexpressible (no update/delete path).
create or replace function public.add_rights_grant(
  p_org_id        uuid,
  p_title_id      uuid,
  p_rights_types  public.rights_type[],
  p_mode          public.territory_mode,
  p_territories   text[],
  p_window_start  timestamptz,
  p_window_end    timestamptz,
  p_effective_from timestamptz
) returns uuid[]
  language plpgsql security definer set search_path = public
as $$
declare
  v_ids uuid[] := '{}';
  v_type public.rights_type;
  v_id uuid;
  v_terr text[] := coalesce(p_territories, '{}');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized to set rights for this organization';
  end if;
  if not exists (select 1 from public.titles t where t.id = p_title_id and t.org_id = p_org_id) then
    raise exception 'Title does not belong to this organization';
  end if;
  if p_rights_types is null or array_length(p_rights_types, 1) is null then
    raise exception 'At least one rights type is required';
  end if;
  if p_mode = 'world' then
    v_terr := '{}';
  elsif array_length(v_terr, 1) is null then
    raise exception 'Territory list required for include/exclude mode';
  end if;

  foreach v_type in array p_rights_types loop
    insert into public.rights_grants
      (org_id, title_id, rights_type, territory_mode, territories,
       window_start, window_end, effective_from, created_by)
    values
      (p_org_id, p_title_id, v_type, p_mode, v_terr,
       p_window_start, p_window_end, coalesce(p_effective_from, now()), auth.uid())
    returning id into v_id;
    v_ids := array_append(v_ids, v_id);
  end loop;
  return v_ids;
end;
$$;

revoke execute on function public.add_rights_grant(uuid, uuid, public.rights_type[], public.territory_mode, text[], timestamptz, timestamptz, timestamptz) from public, anon;
grant  execute on function public.add_rights_grant(uuid, uuid, public.rights_type[], public.territory_mode, text[], timestamptz, timestamptz, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. DELIVERY GATE — can_deliver (rule 12, enforced in the DB)
-- ----------------------------------------------------------------------------
-- True iff an ACTIVE grant (effective_to is null) for (title, rights_type)
-- covers the territory (mode+list) AND p_at falls in the window. This is the
-- single call site the deliveries slice will use. Union semantics via EXISTS.
create or replace function public.can_deliver(
  p_title_id    uuid,
  p_rights_type public.rights_type,
  p_territory   text,
  p_at          timestamptz
) returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.rights_grants g
    where g.title_id = p_title_id
      and g.rights_type = p_rights_type
      and g.effective_to is null
      and (g.window_start is null or p_at >= g.window_start)
      and (g.window_end   is null or p_at <= g.window_end)
      and case g.territory_mode
            when 'world'   then true
            when 'include' then p_territory = any (g.territories)
            when 'exclude' then not (p_territory = any (g.territories))
          end
  );
$$;

revoke execute on function public.can_deliver(uuid, public.rights_type, text, timestamptz) from anon;
grant  execute on function public.can_deliver(uuid, public.rights_type, text, timestamptz) to authenticated;
```

- [ ] **Step 2: Show the destructive SQL for approval, then apply**

Present the trigger-creation and `REVOKE UPDATE, DELETE` statements to the founder. On approval, the founder runs (guard hook blocks the assistant from running it):

```
! supabase migration up
```
Expected: `Applying migration 20260718000200_rights_grants.sql...` then `Local database is up to date.` (NOTICE lines about `drop ... if exists` are expected.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260718000200_rights_grants.sql
git commit -m "feat(db): rights_grants — enums, table, RLS, add_rights_grant RPC, can_deliver gate"
```

---

### Task 2: pgTAP tests — isolation, capability, immutability, union, gate matrix

**Files:**
- Create: `supabase/tests/rights_grants_test.sql`

**Interfaces:**
- Consumes: `add_rights_grant`, `can_deliver`, `rights_grants`, `member_can` (Task 1).

- [ ] **Step 1: Write the test file** (mirrors `contract_rls_test.sql` / `titles_test.sql` idioms)

```sql
-- rights_grants_test.sql
-- Rights grants: tenant isolation, add_rights_grant capability matrix,
-- immutability (the expand-never-contract guarantee), union semantics, and the
-- can_deliver gate matrix (rule 12).

begin;
select plan(14);

select set_config('t.org_a',  gen_random_uuid()::text, false);
select set_config('t.org_b',  gen_random_uuid()::text, false);
select set_config('t.owner',  gen_random_uuid()::text, false);  -- account_owner, A
select set_config('t.deliv',  gen_random_uuid()::text, false);  -- delivery_ops,  A
select set_config('t.viewer', gen_random_uuid()::text, false);  -- viewer,        A
select set_config('t.legal',  gen_random_uuid()::text, false);  -- legal,         A
select set_config('t.gc',     gen_random_uuid()::text, false);  -- GC staff
select set_config('t.title_a',gen_random_uuid()::text, false);
select set_config('t.title_b',gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.owner')::uuid), (current_setting('t.deliv')::uuid),
  (current_setting('t.viewer')::uuid), (current_setting('t.legal')::uuid),
  (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'), (current_setting('t.org_b')::uuid, 'Org B');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner')::uuid,  'account_owner', 'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.deliv')::uuid,  'delivery_ops',  'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.viewer')::uuid, 'viewer',        'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.legal')::uuid,  'legal',         'active');
insert into public.gc_staff (user_id, role) values
  (current_setting('t.gc')::uuid, 'gc_delivery_ops');
insert into public.titles (id, org_id, title) values
  (current_setting('t.title_a')::uuid, current_setting('t.org_a')::uuid, 'Title A'),
  (current_setting('t.title_b')::uuid, current_setting('t.org_b')::uuid, 'Title B');

-- Direct fixture grant (owner-role setup): AVOD, include US, no window.
insert into public.rights_grants
  (org_id, title_id, rights_type, territory_mode, territories, effective_from)
values
  (current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
   'avod', 'include', array['US'], now());

-- can_deliver matrix (owner-role; SECURITY DEFINER decides from args)
select ok(     public.can_deliver(current_setting('t.title_a')::uuid, 'avod', 'US', now()),
  'can_deliver: AVOD US inside include grant');
select ok(not  public.can_deliver(current_setting('t.title_a')::uuid, 'avod', 'CA', now()),
  'can_deliver: AVOD CA NOT covered (not in include list)');
select ok(not  public.can_deliver(current_setting('t.title_a')::uuid, 'svod', 'US', now()),
  'can_deliver: wrong rights_type NOT covered');

-- window boundary
insert into public.rights_grants
  (org_id, title_id, rights_type, territory_mode, territories, window_start, window_end, effective_from)
values
  (current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
   'svod', 'world', '{}', now() + interval '10 days', now() + interval '20 days', now());
select ok(not  public.can_deliver(current_setting('t.title_a')::uuid, 'svod', 'FR', now()),
  'can_deliver: before window = false');
select ok(     public.can_deliver(current_setting('t.title_a')::uuid, 'svod', 'FR', now() + interval '15 days'),
  'can_deliver: inside window + world = true');

-- exclude mode
insert into public.rights_grants
  (org_id, title_id, rights_type, territory_mode, territories, effective_from)
values
  (current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
   'tvod', 'exclude', array['GB'], now());
select ok(     public.can_deliver(current_setting('t.title_a')::uuid, 'tvod', 'US', now()),
  'can_deliver: exclude GB covers US');
select ok(not  public.can_deliver(current_setting('t.title_a')::uuid, 'tvod', 'GB', now()),
  'can_deliver: exclude GB does NOT cover GB');

-- expired grant excluded
insert into public.rights_grants
  (org_id, title_id, rights_type, territory_mode, territories, effective_from, effective_to)
values
  (current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
   'est', 'world', '{}', now() - interval '2 days', now() - interval '1 day');
select ok(not  public.can_deliver(current_setting('t.title_a')::uuid, 'est', 'US', now()),
  'can_deliver: expired grant (effective_to past) excluded');

-- union: adding a second AVOD grant widens coverage
insert into public.rights_grants
  (org_id, title_id, rights_type, territory_mode, territories, effective_from)
values
  (current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
   'avod', 'include', array['CA'], now());
select ok(     public.can_deliver(current_setting('t.title_a')::uuid, 'avod', 'CA', now()),
  'union: second AVOD grant adds CA (scope only grows)');

-- ===== authenticated: tenant isolation + capability matrix =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);

select is((select count(*) from public.rights_grants where org_id = current_setting('t.org_b')::uuid)::int,
  0, 'owner_a CANNOT see org B grants (tenant isolation)');

-- immutability: UPDATE and DELETE both raise (expand-never-contract by construction)
select throws_ok($$ update public.rights_grants set territories = array['XX'] $$,
  '42501', null, 'rights_grants UPDATE blocked (immutable — cannot shrink)');
select throws_ok($$ delete from public.rights_grants $$,
  '42501', null, 'rights_grants DELETE blocked (immutable)');

-- add_rights_grant capability
select lives_ok($$ select public.add_rights_grant(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  array['fast']::public.rights_type[], 'world', '{}', null, null, now()) $$,
  'account_owner: add_rights_grant succeeds');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewer'), 'role', 'authenticated')::text, true);
select throws_ok($$ select public.add_rights_grant(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  array['fast']::public.rights_type[], 'world', '{}', null, null, now()) $$,
  'P0001', null, 'viewer: add_rights_grant raises (not operate-capable)');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run the tests**

Run: `supabase test db`
Expected: `rights_grants_test.sql ... ok`, `All tests successful.` (existing suites stay green.)

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/rights_grants_test.sql
git commit -m "test(db): rights_grants — isolation, capability, immutability, union, can_deliver matrix"
```

---

### Task 3: Regenerate types + `lib/rights.ts` (metadata) + `lib/territories.ts` (resolver)

**Files:**
- Modify: `src/lib/supabase/database.types.ts` (regenerated)
- Create: `src/lib/rights.ts`
- Create: `src/lib/territories.ts`

**Interfaces:**
- Produces:
  - `RightsType` (from `Database["public"]["Enums"]["rights_type"]`), `TerritoryMode`
  - `lib/rights.ts`: `RIGHTS_CATEGORIES: { category: string; types: { code: RightsType; label: string; description: string }[] }[]`, `RIGHTS_META: Record<RightsType, { label: string; category: string }>`
  - `lib/territories.ts`: `ISO_COUNTRIES: Record<string, string>` (alpha-2 → name), `CONTINENTS: Record<string, string[]>`, `resolveTerritories(mode: TerritoryMode, countryCodes: string[]): string[]`, `describeTerritory(mode: TerritoryMode, codes: string[]): string`

- [ ] **Step 1: Regenerate the DB types (strip leaked CLI stdout)**

Founder runs (guard hook blocks the assistant from `supabase gen`):
```
! supabase gen types typescript --local > src/lib/supabase/database.types.ts
```
Then the assistant removes any leaked non-TS lines the CLI writes into the file — the leading `Connecting to db 5432` and trailing `A new version of Supabase CLI...` / `We recommend updating...` lines (observed in the titles slice). Verify: file starts with `export type Json =` and ends with `} as const`.

- [ ] **Step 2: Create `src/lib/rights.ts`**

```ts
import type { Database } from "@/lib/supabase/database.types";

export type RightsType = Database["public"]["Enums"]["rights_type"];

// §9 taxonomy. Category grouping is presentation only (not in the DB). Order
// drives the add-rights picker. Descriptions from the founder-supplied taxonomy.
export const RIGHTS_CATEGORIES: {
  category: string;
  types: { code: RightsType; label: string; description: string }[];
}[] = [
  {
    category: "Theatrical",
    types: [{ code: "theatrical", label: "Theatrical", description: "Commercial cinema exhibition." }],
  },
  {
    category: "Television",
    types: [
      { code: "fta", label: "FTA", description: "Free-to-Air over-the-air networks." },
      { code: "basic_cable", label: "Basic Cable", description: "Non-premium bundled networks." },
      { code: "pay_tv", label: "Pay TV", description: "Premium subscription linear networks." },
      { code: "dth_satellite", label: "DTH / Satellite", description: "Direct-to-Home satellite providers." },
      { code: "ppv", label: "PPV", description: "Pay-Per-View scheduled broadcast." },
    ],
  },
  {
    category: "Video-on-Demand",
    types: [
      { code: "pvod", label: "PVOD", description: "Premium early digital release." },
      { code: "svod", label: "SVOD", description: "Subscription streaming." },
      { code: "hvod", label: "HVOD", description: "Hybrid / ad-supported paid tiers." },
      { code: "tvod", label: "TVOD", description: "Transactional rental." },
      { code: "est", label: "EST", description: "Electronic sell-through purchase." },
      { code: "avod", label: "AVOD", description: "Advertising-based streaming." },
      { code: "fast", label: "FAST", description: "Free ad-supported streaming TV." },
      { code: "fvod", label: "FVOD", description: "Free VOD, flat license, no ads." },
      { code: "bvod", label: "BVOD", description: "Broadcaster catch-up apps." },
    ],
  },
  {
    category: "Out-of-Home & Institutional",
    types: [
      { code: "non_theatrical", label: "Non-Theatrical", description: "Closed-circuit / isolated markets." },
      { code: "hospitality", label: "Hospitality", description: "In-room hotel/hospital systems." },
      { code: "edu", label: "EDU", description: "Educational / institutional streaming." },
      { code: "ppl", label: "PPL", description: "Public performance license." },
    ],
  },
  {
    category: "Physical Media",
    types: [
      { code: "home_video", label: "Home Video", description: "Physical DVD/Blu-ray retail." },
      { code: "mod", label: "MOD", description: "Manufactured-on-Demand disc." },
    ],
  },
];

export const RIGHTS_META: Record<RightsType, { label: string; category: string }> =
  Object.fromEntries(
    RIGHTS_CATEGORIES.flatMap((c) => c.types.map((t) => [t.code, { label: t.label, category: c.category }])),
  ) as Record<RightsType, { label: string; category: string }>;
```

- [ ] **Step 3: Create `src/lib/territories.ts`**

```ts
import type { Database } from "@/lib/supabase/database.types";

export type TerritoryMode = Database["public"]["Enums"]["territory_mode"];

// ISO 3166-1 alpha-2 → English short name. Populate with the full standard set
// (~250 entries) — reference data, not logic. Abbreviated here; the implementer
// includes the complete list.
export const ISO_COUNTRIES: Record<string, string> = {
  US: "United States", CA: "Canada", GB: "United Kingdom", FR: "France",
  DE: "Germany", AU: "Australia", /* … full ISO 3166-1 alpha-2 set … */
};

// Continent → member alpha-2 codes (fixed reference; a UI convenience that
// resolves to explicit codes at grant time — §9 "Europe shifts").
export const CONTINENTS: Record<string, string[]> = {
  "North America": ["US", "CA", "MX" /* … */],
  Europe: ["GB", "FR", "DE" /* … */],
  // Africa, Asia, "South America", Oceania, Antarctica …
};

const isAlpha2 = (c: string) => /^[A-Z]{2}$/.test(c) && c in ISO_COUNTRIES;

// Resolve a UI selection (already expanded to country codes by the form) to a
// deduped, validated, sorted alpha-2 list. Throws on an unknown code.
export function resolveTerritories(mode: TerritoryMode, countryCodes: string[]): string[] {
  if (mode === "world") return [];
  const set = new Set<string>();
  for (const raw of countryCodes) {
    const code = raw.toUpperCase();
    if (!isAlpha2(code)) throw new Error(`Unknown territory code: ${raw}`);
    set.add(code);
  }
  if (set.size === 0) throw new Error("Include/exclude requires at least one country");
  return [...set].sort();
}

export function describeTerritory(mode: TerritoryMode, codes: string[]): string {
  if (mode === "world") return "Worldwide";
  const names = codes.map((c) => ISO_COUNTRIES[c] ?? c);
  const shown = names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4}` : "");
  return mode === "exclude" ? `Worldwide except ${shown}` : shown;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/database.types.ts src/lib/rights.ts src/lib/territories.ts
git commit -m "feat(rights): typed enums + rights-type metadata + ISO territory resolver"
```

---

### Task 4: `/titles/[id]` detail route — grants list + add-rights form + server action

**Files:**
- Create: `src/app/(app)/titles/[id]/page.tsx`
- Create: `src/app/(app)/titles/[id]/add-rights-form.tsx`
- Create: `src/app/(app)/titles/[id]/actions.ts`
- Modify: `src/app/(app)/titles/page.tsx` (link each title row to its detail page)

**Interfaces:**
- Consumes: `add_rights_grant` RPC; `resolveTerritories`, `describeTerritory` (Task 3); `RIGHTS_CATEGORIES`, `RIGHTS_META` (Task 3); `createClient` (`@/lib/supabase/server`); `Card`/`CardBody`, `PageHeader`, `Button`, `Input`, `InlineNotice` primitives.
- Produces: server action `addRights(input: { orgId: string; titleId: string; rightsTypes: RightsType[]; mode: TerritoryMode; countryCodes: string[]; windowStart: string | null; windowEnd: string | null }): Promise<{ error?: string }>`.

- [ ] **Step 1: Create the server action `actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { resolveTerritories, type TerritoryMode } from "@/lib/territories";
import type { RightsType } from "@/lib/rights";

// Add a rights grant (expand = insert) for a title in the active org. Territories
// resolve to ISO codes server-side; the write goes through the add_rights_grant
// SECURITY DEFINER RPC (capability re-checked in the DB).
export async function addRights(input: {
  orgId: string;
  titleId: string;
  rightsTypes: RightsType[];
  mode: TerritoryMode;
  countryCodes: string[];
  windowStart: string | null;
  windowEnd: string | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  if (input.rightsTypes.length === 0) return { error: "Select at least one rights type." };

  let territories: string[];
  try {
    territories = resolveTerritories(input.mode, input.countryCodes);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid territories." };
  }

  const { error } = await supabase.rpc("add_rights_grant", {
    p_org_id: input.orgId,
    p_title_id: input.titleId,
    p_rights_types: input.rightsTypes,
    p_mode: input.mode,
    p_territories: territories,
    p_window_start: input.windowStart,
    p_window_end: input.windowEnd,
    p_effective_from: new Date().toISOString(),
  });
  if (error) return { error: error.message };

  revalidatePath(`/titles/${input.titleId}`);
  return {};
}
```

- [ ] **Step 2: Create the client form `add-rights-form.tsx`**

```tsx
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineNotice } from "@/components/ui/inline-notice";
import { RIGHTS_CATEGORIES, type RightsType } from "@/lib/rights";
import type { TerritoryMode } from "@/lib/territories";
import { addRights } from "./actions";

// Minimal, functional grants form (not designer-grade): multi-select rights
// types grouped by category, a territory mode, and a comma-separated ISO code
// field for include/exclude. Greyscale errors (D3). Operate-capable only.
export function AddRightsForm({ orgId, titleId }: { orgId: string; titleId: string }) {
  const [types, setTypes] = useState<Set<RightsType>>(new Set());
  const [mode, setMode] = useState<TerritoryMode>("world");
  const [codes, setCodes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggle(code: RightsType) {
    setTypes((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (types.size === 0) return setError("Select at least one rights type.");
    setSaving(true);
    setError("");
    const countryCodes =
      mode === "world" ? [] : codes.split(",").map((c) => c.trim()).filter(Boolean);
    const res = await addRights({
      orgId,
      titleId,
      rightsTypes: [...types],
      mode,
      countryCodes,
      windowStart: null,
      windowEnd: null,
    });
    if (res?.error) {
      setError(res.error);
      setSaving(false);
      return;
    }
    setTypes(new Set());
    setCodes("");
    setMode("world");
    setSaving(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {RIGHTS_CATEGORIES.map((cat) => (
          <fieldset key={cat.category} className="flex flex-col gap-1.5">
            <legend className="t-body-sm font-medium text-ink-2">{cat.category}</legend>
            <div className="flex flex-wrap gap-2">
              {cat.types.map((t) => (
                <label key={t.code} className="flex items-center gap-1.5 t-body-sm text-ink-2">
                  <input type="checkbox" checked={types.has(t.code)} onChange={() => toggle(t.code)} />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <label className="t-body-sm text-ink-2">Territory</label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as TerritoryMode)}
          className="rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink"
        >
          <option value="world">Worldwide</option>
          <option value="include">Only these countries</option>
          <option value="exclude">Worldwide except</option>
        </select>
      </div>
      {mode !== "world" ? (
        <Input
          aria-label="ISO country codes"
          value={codes}
          onChange={(e) => setCodes(e.target.value)}
          placeholder="Country codes, comma-separated (e.g. US, CA, GB)"
        />
      ) : null}

      <Button type="submit" disabled={saving || types.size === 0} className="self-start">
        {saving ? "Adding…" : "Add rights"}
      </Button>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </form>
  );
}
```

- [ ] **Step 3: Create the detail page `page.tsx`**

```tsx
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { RIGHTS_META } from "@/lib/rights";
import { describeTerritory } from "@/lib/territories";
import { AddRightsForm } from "./add-rights-form";

// Title detail — hosts the rights grants (§9). RLS-scoped; only operate-capable
// roles (account_owner, delivery_ops — §4) see the add form.
export default async function TitleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name)")
    .eq("status", "active");
  const rows = (memberships ?? []).filter((m) => m.organizations);
  const cookieOrg = (await cookies()).get("gc_active_org")?.value ?? null;
  const activeRow = rows.find((m) => m.organizations!.id === cookieOrg) ?? rows[0] ?? null;
  if (!activeRow) redirect("/");
  const canOperate = activeRow.role === "account_owner" || activeRow.role === "delivery_ops";

  const { data: title } = await supabase
    .from("titles")
    .select("id, title, status, org_id")
    .eq("id", id)
    .maybeSingle();
  if (!title) notFound(); // RLS returns null for another org's title → 404

  const { data: grants } = await supabase
    .from("rights_grants")
    .select("id, rights_type, territory_mode, territories, window_start, window_end")
    .eq("title_id", id)
    .is("effective_to", null)
    .order("created_at", { ascending: false });

  const list = grants ?? [];

  return (
    <>
      <PageHeader title={title.title} subtitle="Rights & territories" backLink={{ href: "/titles", label: "Titles" }} />

      {canOperate ? (
        <div className="mb-6 max-w-xl">
          <AddRightsForm orgId={title.org_id} titleId={title.id} />
        </div>
      ) : null}

      {list.length === 0 ? (
        <Card>
          <CardBody>
            <p className="t-body-sm text-ink-3">No rights granted yet.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((g) => (
            <Card key={g.id}>
              <CardBody className="flex items-start justify-between gap-4">
                <span className="t-body font-medium text-ink">{RIGHTS_META[g.rights_type].label}</span>
                <span className="shrink-0 t-body-sm text-ink-2">
                  {describeTerritory(g.territory_mode, g.territories)}
                </span>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Link title rows to their detail page in `titles/page.tsx`**

Wrap each title card in a link. In `src/app/(app)/titles/page.tsx`, change the mapped `<Card key={t.id}>` block to:

```tsx
import Link from "next/link";
// … inside the list map:
<Link key={t.id} href={`/titles/${t.id}`} className="block">
  <Card className="transition-colors hover:bg-surface-muted">
    <CardBody className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="t-body font-medium text-ink">{t.title}</span>
        <span className="t-body-sm text-ink-3">Added {fmt.format(new Date(t.created_at))}</span>
      </div>
      <span className="shrink-0 t-body-sm text-ink-2">{STATUS_LABELS[t.status]}</span>
    </CardBody>
  </Card>
</Link>
```

- [ ] **Step 5: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all green; `/titles/[id]` appears as a route.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/titles"
git commit -m "feat(rights): title detail route with grants list + add-rights form"
```

---

### Task 5: Verify end-to-end + leak-check

**Files:** none (verification only).

- [ ] **Step 1: Full DB suite**

Run: `supabase test db`
Expected: `All tests successful.` (all suites incl. `rights_grants_test.sql`).

- [ ] **Step 2: App checks**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 3: Leak-check**

Invoke the `leak-check` skill (build + grep `.next/static` for server secrets). Expected: no `SUPABASE_SERVICE_ROLE_KEY` / `sk_`/`rk_`/`whsec_` / server env names in the client bundle; only public keys. This slice adds no new secrets.

- [ ] **Step 4: Manual browser check (founder)**

Sign in as an account_owner → `/titles` → click a title → `/titles/[id]` → add "AVOD" worldwide → see it listed; add "TVOD" "Worldwide except" `GB` → see "Worldwide except United Kingdom". Confirm a `viewer`-role member sees the grants list but no add form.

- [ ] **Step 5: Commit (if any verification fixups were needed)**

```bash
git add -A && git commit -m "chore(rights): verification fixups"
```

---

## Self-Review

**1. Spec coverage:**
- Enums (21 rights types + territory_mode) → Task 1 ✓
- `rights_grants` table (immutable, indexes, CHECKs) → Task 1 ✓
- RLS + triggers → Task 1 ✓
- `add_rights_grant` RPC (expand=insert, one row per type, operate-gated) → Task 1 ✓
- `can_deliver` DB gate → Task 1 ✓
- Append-only union / expand-never-contract → enforced by Task 1 (no UPDATE/DELETE), proven by Task 2 immutability + union tests ✓
- Territory resolver (labels → ISO) → Task 3 ✓
- rights metadata (category/label) → Task 3 ✓
- `/titles/[id]` + grants UI → Task 4 ✓
- pgTAP (isolation, capability, immutability, union, gate matrix) → Task 2 ✓
- Seams (deliveries, $97 fee, takedown) → explicitly excluded in header + Task 1 comment ✓

**2. Placeholder scan:** `lib/territories.ts` abbreviates the ISO/continent *reference data* (not logic) with an explicit "implementer includes the complete list" note — this is data population, not a logic placeholder. All logic, SQL, RPCs, and component code are complete.

**3. Type consistency:** `add_rights_grant` signature (8 params, `rights_type[]`, `territory_mode`) matches across Task 1 (SQL), Task 4 (`.rpc` call), and the `addRights` action. `RightsType`/`TerritoryMode` derive from generated enums (Task 3) and are used consistently in Tasks 3–4. `RIGHTS_META`/`describeTerritory`/`resolveTerritories` names match between definition (Task 3) and use (Task 4). `can_deliver` signature matches between Task 1 and Task 2.
