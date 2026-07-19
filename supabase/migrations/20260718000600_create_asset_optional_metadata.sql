-- ============================================================================
-- 20260718000600_create_asset_optional_metadata.sql
--
-- Make create_asset's advisory metadata params DEFAULT NULL so they generate as
-- OPTIONAL in the TS Database types (Supabase types every non-default function
-- arg as required non-null). Mirrors 20260717000200 (accept_terms) and
-- 20260718000300 (add_rights_grant). Body unchanged. Forward-only; create-or-
-- replace preserves grants.
-- ============================================================================

create or replace function public.create_asset(
  p_org_id           uuid,
  p_title_id         uuid,
  p_kind             public.asset_kind,
  p_storage_key      text,
  p_content_hash     text,
  p_bytes            bigint,
  p_content_type     text default null,
  p_original_filename text default null
) returns uuid
  language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized to add assets for this organization';
  end if;
  if not exists (select 1 from public.titles t where t.id = p_title_id and t.org_id = p_org_id) then
    raise exception 'Title does not belong to this organization';
  end if;
  if coalesce(btrim(p_storage_key), '') = '' or coalesce(btrim(p_content_hash), '') = '' then
    raise exception 'storage_key and content_hash are required';
  end if;

  insert into public.assets
    (org_id, title_id, kind, storage_key, content_hash, bytes, content_type, original_filename, provided_by)
  values
    (p_org_id, p_title_id, p_kind, btrim(p_storage_key), btrim(p_content_hash),
     coalesce(p_bytes, 0), p_content_type, p_original_filename, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.create_asset(uuid, uuid, public.asset_kind, text, text, bigint, text, text) from public, anon;
grant  execute on function public.create_asset(uuid, uuid, public.asset_kind, text, text, bigint, text, text) to authenticated;
