-- ============================================================================
-- 20260718000400_rights_grant_hardening.sql
--
-- Review hardening (final whole-branch review of the rights-grants slice):
--   1. add_rights_grant re-validates territories at the DB layer — normalizes to
--      uppercase, dedupes, and format-checks ISO 3166-1 alpha-2 (^[A-Z]{2}$) —
--      so a DIRECT RPC caller (bypassing the server action's resolveTerritories)
--      cannot persist malformed codes. Full ISO-membership validation (a
--      country_codes reference table) is deferred — see docs/known-divergences.md.
--   2. Dedupe p_rights_types so ['avod','avod'] inserts one row, not two.
--   3. Least privilege: revoke can_deliver from authenticated (no client caller
--      yet — the deliveries slice re-grants with a tenant check when it wires in).
--
-- Signature unchanged (create or replace) — no TS type regeneration needed.
-- Forward-only.
-- ============================================================================

create or replace function public.add_rights_grant(
  p_org_id        uuid,
  p_title_id      uuid,
  p_rights_types  public.rights_type[],
  p_mode          public.territory_mode,
  p_territories   text[],
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

  -- Dedupe rights types (one immutable row per distinct type).
  for v_type in select distinct unnest(p_rights_types) loop
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

-- Least privilege: no client caller for can_deliver yet (deliveries seam).
revoke execute on function public.can_deliver(uuid, public.rights_type, text, timestamptz) from authenticated;
