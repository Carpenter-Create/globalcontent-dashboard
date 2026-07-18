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
