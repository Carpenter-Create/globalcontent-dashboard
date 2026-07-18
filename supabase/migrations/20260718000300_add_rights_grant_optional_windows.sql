-- ============================================================================
-- 20260718000300_add_rights_grant_optional_windows.sql
--
-- Make add_rights_grant's window/effective params DEFAULT NULL so they generate
-- as OPTIONAL in the TS Database types (Supabase types every non-default
-- function arg as required non-null). Mirrors 20260717000200 for accept_terms.
-- Body unchanged: windows null = open-ended; effective_from coalesces to now().
-- Forward-only; create-or-replace preserves the existing grants.
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
