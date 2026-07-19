-- ============================================================================
-- 20260718000700_title_metadata.sql
--
-- INTENT: Metadata intake (domain-spec §12) — path 1 (guided form). One jsonb
-- blob per title, validated app-side by the canonical registry (lib/metadata.ts)
-- and written only via set_title_metadata. Mutable draft data (client edits the
-- form); audit_log is the change record (golden rule 5). "Required blocks
-- delivery" is enforced later at the delivery/in_review gate, not here.
--
-- DELIBERATELY EXCLUDED (seams): paths 2/3 (template, BYO-sheet + AI mapping),
-- findings/health queue, export mapping, delivery-blocking of required fields.
--
-- DESTRUCTIVE OPS (approved before apply): audit + updated_at triggers on
-- title_metadata. Forward-only + idempotent.
-- ============================================================================

create table if not exists public.title_metadata (
  title_id   uuid primary key references public.titles(id)        on delete restrict,
  org_id     uuid not null    references public.organizations(id) on delete restrict,
  data       jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists title_metadata_org_idx on public.title_metadata (org_id);

drop trigger if exists audit_title_metadata on public.title_metadata;
create trigger audit_title_metadata after insert or update or delete on public.title_metadata
  for each row execute function public.tg_audit();

drop trigger if exists set_updated_at_title_metadata on public.title_metadata;
create trigger set_updated_at_title_metadata before update on public.title_metadata
  for each row execute function public.tg_set_updated_at();

alter table public.title_metadata enable row level security;
revoke all on public.title_metadata from anon;

drop policy if exists title_metadata_select on public.title_metadata;
create policy title_metadata_select on public.title_metadata for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));
-- INSERT/UPDATE: only via set_title_metadata() RPC. No client write policy;
-- direct client writes are additionally revoked in 000800 (hard 42501). The RPC
-- is SECURITY DEFINER, so its upsert is unaffected (owner keeps privileges).

-- Write path: upsert. Capability re-checked; title must belong to the org. The
-- app validates p_data against the canonical zod schema BEFORE calling this.
create or replace function public.set_title_metadata(
  p_org_id   uuid,
  p_title_id uuid,
  p_data     jsonb
) returns void
  language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized to edit metadata for this organization';
  end if;
  if not exists (select 1 from public.titles t where t.id = p_title_id and t.org_id = p_org_id) then
    raise exception 'Title does not belong to this organization';
  end if;

  insert into public.title_metadata (title_id, org_id, data)
    values (p_title_id, p_org_id, coalesce(p_data, '{}'::jsonb))
  on conflict (title_id) do update
    set data = excluded.data, updated_at = now();
end;
$$;

revoke execute on function public.set_title_metadata(uuid, uuid, jsonb) from public, anon;
grant  execute on function public.set_title_metadata(uuid, uuid, jsonb) to authenticated;
