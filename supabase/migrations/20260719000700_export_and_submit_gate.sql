-- ============================================================================
-- 20260719000700_export_and_submit_gate.sql
--
-- INTENT: (1) export_records — append-only snapshot of every metadata export GC
-- produces (provenance: what GC represented to an endpoint), written only via the
-- GC-only record_export RPC. (2) submit_title gains a REQUIRED-metadata gate so a
-- title can't be turned in to GC without its required fields — export relies on this.
--
-- DESTRUCTIVE OPS (approved before apply): create table + functions; revokes;
-- replace submit_title (signature unchanged). Forward-only + idempotent.
-- ============================================================================

create table if not exists public.export_records (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors(id) on delete restrict,
  title_ids   uuid[] not null,
  payload     jsonb not null,          -- the exact rows exported (snapshot)
  exported_by uuid references auth.users(id),
  exported_at timestamptz not null default now()
);
create index if not exists export_records_vendor_idx on public.export_records (vendor_id);
create index if not exists export_records_at_idx on public.export_records (exported_at desc);

alter table public.export_records enable row level security;
revoke all on public.export_records from anon;
revoke insert, update, delete on public.export_records from authenticated, service_role;  -- RPC-only, immutable
drop policy if exists export_records_select on public.export_records;
create policy export_records_select on public.export_records for select to authenticated
  using (public.is_gc_staff(auth.uid()));

create or replace function public.record_export(p_vendor_id uuid, p_title_ids uuid[], p_payload jsonb)
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  insert into public.export_records (vendor_id, title_ids, payload, exported_by)
  values (p_vendor_id, p_title_ids, p_payload, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.record_export(uuid, uuid[], jsonb) from public, anon;
grant  execute on function public.record_export(uuid, uuid[], jsonb) to authenticated;

-- submit_title: add the required-metadata gate (signature unchanged → create or replace).
create or replace function public.submit_title(p_org_id uuid, p_title_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_data jsonb;
  v_key  text;
  -- REQUIRED tier from src/lib/metadata.ts METADATA_FIELDS — keep in sync.
  v_required text[] := array['synopsis','runtime_minutes','release_year','genre','primary_language','country_of_origin'];
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized to submit titles for this organization';
  end if;

  select data into v_data from public.title_metadata where title_id = p_title_id;
  foreach v_key in array v_required loop
    if v_data is null or coalesce(btrim(v_data->>v_key), '') = '' then
      raise exception 'Cannot submit: required metadata field "%" is missing', v_key;
    end if;
  end loop;

  update public.titles
    set status = 'in_review'
    where id = p_title_id and org_id = p_org_id and status = 'draft';
  if not found then
    raise exception 'Title not found in this organization, or not in draft';
  end if;
end;
$$;
revoke execute on function public.submit_title(uuid, uuid) from public, anon;
grant  execute on function public.submit_title(uuid, uuid) to authenticated;
