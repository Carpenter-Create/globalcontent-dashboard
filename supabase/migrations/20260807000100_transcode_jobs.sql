-- 20260807000100_transcode_jobs.sql
--
-- INTENT: an uploaded master triggers a MediaConvert job that renders a small viewing
-- proxy (the object the buyer-facing screener page actually streams — masters archive to
-- Glacier at 90 days per 111fbbe, and a buyer must never wait on a 5-12h restore mid-pitch).
-- This migration is the job ledger and the two service-role functions that resolve a
-- completion or failure event from that pipeline. Submission (T4) and the callback route
-- (T5) are later slices; this is the record they write to and read from.
--
-- THE OUTPUT KEY IS AUTHORITY, NOT A HINT. expected_output_key is decided and written at
-- SUBMIT time (create_transcode_job, called from the upload path, which already knows the
-- deterministic key MediaConvert will be told to render to). register_transcode_output
-- never learns a key from the inbound event beyond using it as a claim to verify — it
-- compares the claimed key against what THIS ROW already recorded, and refuses on any
-- mismatch. That single equality check is what stops a forged completion event (or a
-- MediaConvert account emitting for the wrong job) from registering an arbitrary S3 object
-- as a screener on any title. Softening it to "trust the event" would hand an attacker who
-- can produce one EventBridge-shaped payload the ability to point a live buyer link at
-- content they chose. Nothing here takes the key from anywhere but the job row.
--
-- IDEMPOTENCY. EventBridge (and SNS before it) is at-least-once delivery; a completion for
-- the same job can arrive twice. register_transcode_output checks `status = 'complete'`
-- BEFORE the key comparison and returns the already-registered output_asset_id verbatim —
-- no second asset row, no second title/audit write. This also means a duplicate delivery's
-- own storage_key/bytes/content_hash are never re-validated on the second call; that is
-- fine because a genuine duplicate carries the same payload as the first, and a job that
-- is already complete can no longer be pointed anywhere new by this function regardless of
-- what a second caller claims.
--
-- THE screener_source FLIP IS BOUNDED, NOT UNCONDITIONAL (founder decision). A title
-- defaults to 'master' (screener room streams the master itself, pre-transcode). Once this
-- job's proxy lands, the title should switch to serving THAT proxy instead — but only if
-- the client never explicitly chose 'dedicated' via set_screener_source. Flipping over an
-- explicit 'dedicated' choice would silently swap a client-uploaded screener for a
-- pipeline-generated one they didn't ask for. The guard is `if v_source = 'master' then`,
-- checked at registration time (not cached from submission), so a client who calls
-- set_screener_source('dedicated') while a job is in flight still wins.
--
-- THE AUDIT ROW IS IDS AND A BOOLEAN, NEVER A KEY. 20260806000400's header documents why a
-- table-wide to_jsonb(row) trigger was rejected on portal_links (it would have copied a
-- live share_token into an append-only, un-purgeable table forever). transcode_jobs has the
-- same shape of hazard: expected_output_key IS an S3 object key, and the row also carries
-- external_job_id (a third-party identifier). So, as with attach_link_vendor, there is NO
-- trigger on this table — one hand-built audit_log row is inserted only for the
-- security-critical transition (registering the asset that a buyer link will serve), and
-- it carries exactly `{"asset_id": ..., "flipped_source": boolean}`. Job submission and
-- job failure are not separately audited: the transcode_jobs row itself is the append-only-
-- in-spirit record of those transitions (status/failure_reason/timestamps, never deleted),
-- and neither exposes new capability the way registering a servable asset does.
--
-- DEVIATION FROM THE BRIEF, NOTED FOR REVIEW: create_transcode_job additionally verifies
-- that p_title_id belongs to p_org_id, and that p_source_asset_id belongs to that same
-- (org, title) — the same shape of check create_asset (20260718000500) already performs
-- for the analogous "attach a row to a title within an org" operation. The brief's literal
-- SQL omits it; without it, a caller who operates SOME org could submit a job whose
-- title_id/source_asset_id belong to a DIFFERENT org's title, and register_transcode_output
-- would then insert a screener asset carrying that job's org_id next to a title_id from
-- another org — an org_id/title_id mismatch nothing downstream expects. Mirroring the
-- existing precedent closes that gap at negligible cost and no behavior change for any
-- caller that already passes a consistent (org, title, asset) triple, which every real
-- caller does.
--
-- TABLE GRANTS — NOT IN THE BRIEF, REQUIRED ANYWAY. 20260726000600 measured (on a
-- throwaway rebuild, Supabase CLI 2.109.1) that the platform's current default privilege
-- set no longer grants SELECT/INSERT/UPDATE/DELETE to a freshly created table — every one
-- of the 26 existing tables needed an explicit GRANT restored by that migration, or
-- `authenticated` 403s on every read regardless of RLS. transcode_jobs is the first new
-- table created since that migration landed, so it is the first table that would actually
-- prove or disprove that finding on a from-scratch apply. Without an explicit
-- `grant select ... to authenticated` below, the transcode_jobs_select policy two sections
-- down is dead: the table-privilege check runs before RLS is ever evaluated, so a correct
-- policy behind a missing grant still denies every read. service_role is granted the same
-- shape (select, insert, update — never delete; rule 2, nothing here is ever deleted) for
-- consistency with every other service_role-writable table in that migration, ahead of T6
-- (reconciliation), which is expected to query/patch this table directly outside the two
-- RPCs below.
--
-- DESTRUCTIVE OPS (approved before apply): CREATE TYPE public.transcode_status. CREATE
-- TABLE public.transcode_jobs with three indexes. ENABLE ROW LEVEL SECURITY on it, one
-- SELECT policy, and REVOKE INSERT/UPDATE/DELETE from authenticated and anon (all writes
-- go through the three functions below). Explicit GRANT SELECT to authenticated and GRANT
-- SELECT/INSERT/UPDATE to service_role (see note above). CREATE three functions —
-- create_transcode_job (granted to authenticated only), register_transcode_output and
-- fail_transcode_job (both revoked from public/anon/authenticated, granted to service_role
-- only — no client caller exists or ever should). No existing table, row, type, or function
-- is altered or dropped. Forward-only. To roll back: drop the three functions, drop the
-- table, drop the type — no other object depends on any of them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TYPE + TABLE
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.transcode_status as enum
    ('submitted','running','complete','failed','submit_failed');
exception when duplicate_object then null; end $$;

create table if not exists public.transcode_jobs (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete restrict,
  title_id            uuid not null references public.titles(id)        on delete restrict,
  source_asset_id     uuid not null references public.assets(id)        on delete restrict,
  output_asset_id     uuid references public.assets(id)                 on delete restrict,
  -- Decided at SUBMIT time and never taken from the completion event. The callback
  -- verifies an object exists HERE; it does not learn the key from AWS. That is what
  -- stops a forged event registering an arbitrary S3 key as a screener.
  expected_output_key text not null,
  external_job_id     text unique,
  status              public.transcode_status not null default 'submitted',
  failure_reason      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz
);
create index if not exists transcode_jobs_org_idx    on public.transcode_jobs (org_id);
create index if not exists transcode_jobs_title_idx  on public.transcode_jobs (title_id);
create index if not exists transcode_jobs_status_idx on public.transcode_jobs (status, created_at);

-- ----------------------------------------------------------------------------
-- 2. TABLE GRANTS — see header. anon gets nothing (no grant, matching 000600's stated
--    convention); it has no policy either.
-- ----------------------------------------------------------------------------
grant select on public.transcode_jobs to authenticated;
grant select, insert, update on public.transcode_jobs to service_role;

-- ----------------------------------------------------------------------------
-- 3. RLS — read for the owning org and GC, no client writes. All mutation is via RPC.
-- ----------------------------------------------------------------------------
alter table public.transcode_jobs enable row level security;
revoke insert, update, delete on public.transcode_jobs from authenticated, anon;

drop policy if exists transcode_jobs_select on public.transcode_jobs;
create policy transcode_jobs_select on public.transcode_jobs for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));

-- ----------------------------------------------------------------------------
-- 4. create_transcode_job — operate-gated, called from the upload path.
-- ----------------------------------------------------------------------------
create or replace function public.create_transcode_job(
  p_org_id              uuid,
  p_title_id            uuid,
  p_source_asset_id     uuid,
  p_expected_output_key text,
  p_external_job_id     text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized';
  end if;

  -- Tenant-consistency check (see migration header "DEVIATION FROM THE BRIEF"), mirroring
  -- create_asset's existing precedent for the same class of operation.
  if not exists (select 1 from public.titles t where t.id = p_title_id and t.org_id = p_org_id) then
    raise exception 'Title does not belong to this organization';
  end if;
  if not exists (
    select 1 from public.assets a
    where a.id = p_source_asset_id and a.org_id = p_org_id and a.title_id = p_title_id
  ) then
    raise exception 'Source asset does not belong to this title';
  end if;

  if coalesce(btrim(p_expected_output_key), '') = '' then
    raise exception 'expected_output_key required';
  end if;

  insert into public.transcode_jobs
    (org_id, title_id, source_asset_id, expected_output_key, external_job_id, status)
  values (p_org_id, p_title_id, p_source_asset_id, btrim(p_expected_output_key),
          nullif(btrim(p_external_job_id), ''), 'submitted')
  returning id into v_id;
  return v_id;
end; $$;

revoke execute on function public.create_transcode_job(uuid, uuid, uuid, text, text) from public, anon;
grant  execute on function public.create_transcode_job(uuid, uuid, uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. register_transcode_output — the security-critical one. service_role ONLY. Everything
--    it writes is derived from the JOB ROW, never from the caller beyond the job id and the
--    verified object facts (storage_key, bytes, content_hash). See migration header for the
--    authority check, idempotency, and screener_source flip reasoning.
-- ----------------------------------------------------------------------------
create or replace function public.register_transcode_output(
  p_job_id       uuid,
  p_storage_key  text,
  p_bytes        bigint,
  p_content_hash text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_job public.transcode_jobs; v_asset_id uuid; v_source public.screener_source;
begin
  select * into v_job from public.transcode_jobs where id = p_job_id;
  if not found then raise exception 'Job not found'; end if;

  -- Idempotent: a duplicate EventBridge delivery must not register a second asset.
  if v_job.status = 'complete' then return v_job.output_asset_id; end if;

  -- The key is NOT taken on trust. It must equal what we recorded at submit time.
  if btrim(p_storage_key) <> v_job.expected_output_key then
    raise exception 'Output key does not match the job';
  end if;

  insert into public.assets (org_id, title_id, kind, storage_key, content_hash, bytes, content_type)
  values (v_job.org_id, v_job.title_id, 'screener', v_job.expected_output_key,
          p_content_hash, p_bytes, 'video/mp4')
  returning id into v_asset_id;

  -- Founder decision: flip ONLY from the default. An explicit 'dedicated' choice by the
  -- client is theirs and must survive.
  select screener_source into v_source from public.titles where id = v_job.title_id;
  if v_source = 'master' then
    update public.titles set screener_source = 'dedicated' where id = v_job.title_id;
  end if;

  update public.transcode_jobs
     set status = 'complete', output_asset_id = v_asset_id,
         completed_at = now(), updated_at = now()
   where id = p_job_id;

  -- Ids and a boolean only — no storage keys, no filenames, no names (see migration header).
  insert into public.audit_log (org_id, entity, entity_id, action, actor, after)
  values (v_job.org_id, 'transcode_jobs', p_job_id, 'proxy_registered', null,
          jsonb_build_object('asset_id', v_asset_id, 'flipped_source', v_source = 'master'));

  return v_asset_id;
end; $$;

revoke execute on function public.register_transcode_output(uuid, text, bigint, text) from public, anon, authenticated;
grant  execute on function public.register_transcode_output(uuid, text, bigint, text) to service_role;

-- ----------------------------------------------------------------------------
-- 6. fail_transcode_job — service_role ONLY. No client caller.
-- ----------------------------------------------------------------------------
create or replace function public.fail_transcode_job(p_job_id uuid, p_reason text default null)
  returns void language plpgsql security definer set search_path = public as $$
begin
  update public.transcode_jobs
     set status = 'failed', failure_reason = nullif(btrim(p_reason), ''), updated_at = now()
   where id = p_job_id and status <> 'complete';
  if not found then raise exception 'Job not found or already complete'; end if;
end; $$;

revoke execute on function public.fail_transcode_job(uuid, text) from public, anon, authenticated;
grant  execute on function public.fail_transcode_job(uuid, text) to service_role;
