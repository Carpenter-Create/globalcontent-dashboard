-- ============================================================================
-- 20260719000300_rights_exclusivity.sql
--
-- INTENT: capture per-grant EXCLUSIVITY in the rights carve-out (domain-spec §9;
-- design 2026-07-19-rights-exclusivity). A grant IS (rights_type, territory set),
-- so exclusivity rides on the row as one boolean. Required at intake — the
-- add_rights_grant RPC gains a REQUIRED p_exclusive (no default). CAPTURE ONLY:
-- nothing reads `exclusive` yet; the cross-client conflict rule (soft warning at
-- review, hard block at delivery) is a later slice.
--
-- DESTRUCTIVE OPS (approved before apply): alter table add column; drop + replace
-- add_rights_grant (arg list changes → new overload; drop the old to avoid
-- ambiguity). Forward-only + idempotent where possible.
-- ============================================================================

alter table public.rights_grants
  add column if not exists exclusive boolean not null default false;
comment on column public.rights_grants.exclusive is
  'Exclusivity of this grant''s (rights_type, territory set). Read by the cross-client conflict rule (soft warning at review, hard block at delivery); unused at capture time. New declarations always set it explicitly; the default only applies to pre-existing rows.';

-- Drop the old 8-arg signature so the new 9-arg one is unambiguous.
drop function if exists public.add_rights_grant(
  uuid, uuid, public.rights_type[], public.territory_mode, text[],
  timestamptz, timestamptz, timestamptz);

-- p_exclusive is REQUIRED, so it must precede the defaulted params.
create or replace function public.add_rights_grant(
  p_org_id        uuid,
  p_title_id      uuid,
  p_rights_types  public.rights_type[],
  p_mode          public.territory_mode,
  p_territories   text[],
  p_exclusive     boolean,
  p_window_start  timestamptz default null,
  p_window_end    timestamptz default null,
  p_effective_from timestamptz default null
) returns uuid[]
  language plpgsql security definer set search_path = public
as $$
declare
  v_ids uuid[] := '{}';
  v_type public.rights_type;
  v_id uuid;
  v_terr text[];
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
  -- Defense in depth: the generated TS makes p_exclusive required, but a direct
  -- SQL caller could still pass null. Exclusivity is never implicit.
  if p_exclusive is null then
    raise exception 'Exclusivity must be specified';
  end if;

  -- Territories: normalize + dedupe + format-validate at the DB layer.
  if p_mode = 'world' then
    v_terr := '{}';
  else
    select array_agg(distinct upper(btrim(t)))
      into v_terr
      from unnest(coalesce(p_territories, '{}')) t
      where btrim(t) <> '';
    if v_terr is null or array_length(v_terr, 1) is null then
      raise exception 'Territory list required for include/exclude mode';
    end if;
    if exists (select 1 from unnest(v_terr) t where t !~ '^[A-Z]{2}$') then
      raise exception 'Territories must be ISO 3166-1 alpha-2 codes';
    end if;
  end if;

  -- Dedupe rights types (one immutable row per distinct type); all share p_exclusive.
  for v_type in select distinct unnest(p_rights_types) loop
    insert into public.rights_grants
      (org_id, title_id, rights_type, territory_mode, territories,
       exclusive, window_start, window_end, effective_from, created_by)
    values
      (p_org_id, p_title_id, v_type, p_mode, v_terr,
       p_exclusive, p_window_start, p_window_end, coalesce(p_effective_from, now()), auth.uid())
    returning id into v_id;
    v_ids := array_append(v_ids, v_id);
  end loop;
  return v_ids;
end;
$$;

revoke execute on function public.add_rights_grant(
  uuid, uuid, public.rights_type[], public.territory_mode, text[],
  boolean, timestamptz, timestamptz, timestamptz) from public, anon;
grant  execute on function public.add_rights_grant(
  uuid, uuid, public.rights_type[], public.territory_mode, text[],
  boolean, timestamptz, timestamptz, timestamptz) to authenticated;
