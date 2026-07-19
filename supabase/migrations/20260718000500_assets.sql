-- ============================================================================
-- 20260718000500_assets.sql
--
-- INTENT: Asset upload (domain-spec §12, golden rule 14) — the immutable record
-- of a platform-ready file uploaded to S3. The row is the source record for the
-- file (received_at/content_hash/provided_by inline); audit_log is its provenance
-- (golden rule 5). S3 KEY only, NEVER a URL (rule 14). Written once, on multipart
-- complete, via create_asset — no half-uploaded rows (S3 holds in-flight state).
--
-- DELIBERATELY EXCLUDED (seams): download/CloudFront signing, Glacier tiering +
-- restoring state, purge cron. No status column yet — an uploaded asset is simply
-- stored; lifecycle states arrive with the delivery/Glacier slices.
--
-- DESTRUCTIVE OPS (approved before apply): audit trigger on assets;
-- REVOKE UPDATE, DELETE on assets (immutability). Forward-only + idempotent.
-- ============================================================================

do $$ begin
  create type public.asset_kind as enum ('master','caption','artwork');
exception when duplicate_object then null; end $$;

create table if not exists public.assets (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete restrict,
  title_id          uuid not null references public.titles(id)        on delete restrict,
  kind              public.asset_kind not null,
  storage_key       text not null,     -- S3 object key; NEVER a URL (rule 14)
  content_hash      text not null,     -- S3 composite SHA-256 checksum (provenance)
  bytes             bigint not null check (bytes >= 0),
  content_type      text,              -- client-declared MIME (advisory)
  original_filename text,
  received_at       timestamptz not null default now(),
  provided_by       uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists assets_org_idx        on public.assets (org_id);
create index if not exists assets_title_idx       on public.assets (title_id);
create index if not exists assets_title_kind_idx  on public.assets (title_id, kind);

-- Provenance: reuse the generic audit trigger (assets has org_id). No updated_at
-- trigger — the row is immutable.
drop trigger if exists audit_assets on public.assets;
create trigger audit_assets after insert or update or delete on public.assets
  for each row execute function public.tg_audit();

alter table public.assets enable row level security;
revoke all on public.assets from anon;

drop policy if exists assets_select on public.assets;
create policy assets_select on public.assets for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));
-- INSERT: only via create_asset(). UPDATE/DELETE: none + revoked below (immutable).

revoke update, delete on public.assets from authenticated, service_role;

-- Write path: create_asset. Called by /api/assets/complete AFTER S3
-- CompleteMultipartUpload. Capability re-checked; title must belong to the org.
create or replace function public.create_asset(
  p_org_id           uuid,
  p_title_id         uuid,
  p_kind             public.asset_kind,
  p_storage_key      text,
  p_content_hash     text,
  p_bytes            bigint,
  p_content_type     text,
  p_original_filename text
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
