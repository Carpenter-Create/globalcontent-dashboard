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
-- mismatch. That single check is what stops a forged completion event (or a MediaConvert
-- account emitting for the wrong job) from registering an arbitrary S3 object as a screener
-- on any title. Nothing here takes the key from anywhere but the job row.
--
-- FIX ROUND 1 (this section added; the checks below were not in the first draft) —
--
--   CRITICAL: the comparison MUST use `is distinct from`, not `<>`. `btrim(NULL) <> 'key'`
--   is SQL NULL, and `if NULL then` does not branch — a malformed EventBridge payload with
--   a missing field (no attacker required) walked straight past the only defence this
--   migration has, registered a screener asset for an object never verified to exist,
--   flipped screener_source, marked the job 'complete' (permanently — assets are immutable
--   and fail_transcode_job refuses a 'complete' job), and left no recovery path through any
--   RPC. Fixed below with `coalesce(btrim(p_storage_key), '') is distinct from
--   v_job.expected_output_key`.
--
--   THE THREE-VALUED-LOGIC SWEEP this finding demanded, checked line by line rather than
--   just the one flagged comparison:
--     - `if v_job.status = 'complete'` — status is NOT NULL (enum, default 'submitted');
--       never null. Safe.
--     - `if v_source = 'master'` — v_source is read from titles.screener_source, NOT NULL
--       (default 'master'); v_job.title_id is FK-restricted so the title always exists and
--       the select always finds exactly one row. Safe. (If this select ever somehow found
--       no row, the comparison would be NULL/false and the flip would simply not happen —
--       fails toward "don't flip," the safe direction, not toward exposure.)
--     - fail_transcode_job's `status <> 'complete'` — same NOT NULL enum column. Safe. A
--       NULL p_job_id makes `id = NULL` unknown for every row, so the UPDATE matches zero
--       rows and the function reports 'Job not found or already complete' — fails closed,
--       not a bypass.
--     - create_transcode_job's tenant checks use NOT EXISTS(...), which is immune by
--       construction: EXISTS/NOT EXISTS always collapses to boolean, never NULL, regardless
--       of what the inner WHERE clause evaluates to for any given row. A NULL p_title_id or
--       p_source_asset_id simply matches no row and correctly raises.
--   Nothing else in either new function compares a nullable input with `=`/`<>`/`not in`.
--
--   IMPORTANT: register_transcode_output's SELECT took no row lock. EventBridge is
--   at-least-once delivery — exactly the case the idempotency comment above claims to
--   handle — so two concurrent deliveries for the same job could both read 'submitted',
--   both pass the key check, and both INSERT: two immutable, undeletable screener assets
--   sharing a key, one orphaned forever. Fixed with `for update` on that select: the second
--   caller blocks until the first commits, then re-reads the now-'complete' row and takes
--   the idempotent early-return branch instead of racing it.
--
--   IMPORTANT: `grant ... insert, update ... to service_role` was removed. Both RPCs are
--   SECURITY DEFINER and run as their owner regardless of the caller's own table grants, so
--   service_role never needed table-level write access for either to work. Leaving the
--   grant in place would let the callback route — or a compromised service key — set
--   `status='complete', output_asset_id=<anything>` directly, skipping register_
--   transcode_output's key check entirely. service_role now gets SELECT only. Add a write
--   grant only when a task that needs direct writes exists and can be reviewed on its own
--   terms.
--
--   IMPORTANT: `anon` was not explicitly revoked, and `service_role` kept DELETE. On this
--   founder's production database, 20260726000300 narrowed the default ACL only for
--   TRUNCATE/REFERENCES/TRIGGER/MAINTAIN — a table created there still arrives with
--   SELECT/INSERT/UPDATE/DELETE for anon/authenticated/service_role, exactly like every one
--   of the 26 tables 20260726000600 had to fix, and — checked properly this time, see the
--   TABLE GRANTS note below — like 20260726000900's organization_payout_details, created
--   after it. That table's own grants section states the fix explicitly: `revoke all on
--   ... from anon`. This migration was missing that revoke, and never revoked DELETE from
--   service_role at all, contradicting its own claim that nothing here is ever deleted.
--   Both fixed below.
--
--   IMPORTANT: p_content_hash and p_bytes were written unvalidated. create_asset refuses an
--   empty content_hash and btrims it before storing; this function did neither, so an empty
--   string could land in an immutable provenance field. p_bytes had no default and no
--   coalesce, so a NULL would 23502 rather than falling back to 0 the way create_asset does.
--   Both now match create_asset's handling exactly.
--
--   IMPORTANT: expected_output_key had no uniqueness constraint. The key is deterministic
--   and a retry feature is planned, so a resubmit could produce a second job row carrying
--   the identical key, and both rows could independently register — two "immutable" assets
--   for one real S3 object, one of them describing something that was overwritten or never
--   existed under that description.
--
--   TWO WAYS TO CLOSE IT WERE CONSIDERED. (a) a partial unique index on title_id where
--   status in ('submitted','running') — one active job per title. (b) a plain unique
--   constraint on expected_output_key itself. (a) was rejected on inspection: it only
--   blocks two rows from being ACTIVE at once for the same title. register_transcode_output
--   still only excludes status = 'complete', not any terminal state — so a 'failed' job's
--   late, stale completion event stays completable. Sequence: job1 (key K) fails; a new
--   job2 (key K, same title) is created — legal under (a), since job1 is no longer active;
--   job1's stale event finally arrives, job1.status still isn't 'complete', the key still
--   matches K, so it registers; job2's own genuine completion event later arrives and
--   registers too — two assets, key K, exactly the hazard this finding named, and (a) never
--   stopped it. (b), a flat `unique` on expected_output_key, closes it unconditionally: no
--   two rows, in any status, ever share a key, full stop. Chosen. The cost is that a retry
--   which deliberately reuses an old, deterministically-identical key is rejected outright
--   (23505) rather than silently accepted — the correct failure mode for "this key is
--   already spoken for," and it pushes any future retry feature toward minting a fresh key
--   per job (the same shape assetKey() already uses elsewhere in this app — a UUID path
--   segment per upload — per 111fbbe), rather than reusing one a DB constraint has to keep
--   arbitrating.
--
--   ALSO FIXED: create_transcode_job's source-asset check didn't verify `kind = 'master'` —
--   a poster or caption could be submitted as a transcode source. Added.
--
--   ALSO CORRECTED (report, not code): the original report claimed transcode_jobs was "the
--   first table created since 20260726000600," found by grepping migration filenames dated
--   20260727 onward. That grep's date range was wrong — it skipped 20260726000900
--   (organization_payout_details), which sorts AFTER 20260726000600 on the same day and IS
--   a new table created since. The underlying conclusion (transcode_jobs needs its own
--   explicit grants; nothing supplies them automatically) was never in doubt — that table's
--   own header states the identical requirement — but the specific "first" claim was false
--   and is corrected in the task report, not asserted here again.
--
--   ALSO CORRECTED (header, not code): the earlier draft of this header claimed the audit
--   trail here carries no storage key anywhere. True only of the hand-built row this
--   migration adds. The `insert into public.assets` a few lines down still fires the
--   pre-existing `audit_assets` trigger (20260718000500), which writes the WHOLE assets row
--   via to_jsonb(new) — storage_key included. That is how every asset this application has
--   ever created gets audited, not a regression this migration introduces, and not the same
--   hazard 20260806000400 documented for portal_links.share_token: a storage key alone is
--   not a bearer credential — it grants nothing without an app-issued signed URL. Noted so
--   the header states what is actually delivered rather than overclaiming.
--
-- IDEMPOTENCY. EventBridge (and SNS before it) is at-least-once delivery; a completion for
-- the same job can arrive twice. register_transcode_output checks `status = 'complete'`
-- BEFORE the key comparison (now under a row lock — see FIX ROUND 1) and returns the
-- already-registered output_asset_id verbatim — no second asset row, no second title/audit
-- write. A duplicate delivery's own storage_key/bytes/content_hash are never re-validated
-- on the second call; that is fine because a genuine duplicate carries the same payload as
-- the first, and a job that is already complete can no longer be pointed anywhere new by
-- this function regardless of what a second caller claims.
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
-- THE AUDIT ROW IS IDS AND A BOOLEAN, NEVER A KEY (the hand-built row itself — see FIX
-- ROUND 1's correction above for what the pre-existing assets trigger separately captures).
-- 20260806000400's header documents why a table-wide to_jsonb(row) trigger was rejected on
-- portal_links (it would have copied a live share_token into an append-only, un-purgeable
-- table forever). transcode_jobs has the same shape of hazard: expected_output_key IS an S3
-- object key, and the row also carries external_job_id (a third-party identifier). So, as
-- with attach_link_vendor, there is NO trigger on this table — one hand-built audit_log row
-- is inserted only for the security-critical transition (registering the asset that a buyer
-- link will serve), and it carries exactly `{"asset_id": ..., "flipped_source": boolean}`.
-- Job submission and job failure are not separately audited: the transcode_jobs row itself
-- is the append-only-in-spirit record of those transitions (status/failure_reason/
-- timestamps, never deleted), and neither exposes new capability the way registering a
-- servable asset does.
--
-- DEVIATION FROM THE BRIEF, NOTED FOR REVIEW: create_transcode_job additionally verifies
-- that p_title_id belongs to p_org_id, and that p_source_asset_id belongs to that same
-- (org, title) AND is kind = 'master' — the same shape of check create_asset
-- (20260718000500) already performs for the analogous "attach a row to a title within an
-- org" operation. The brief's literal SQL omits it; without it, a caller who operates SOME
-- org could submit a job whose title_id/source_asset_id belong to a DIFFERENT org's title
-- (or whose source is a poster/caption, not a master), and register_transcode_output would
-- then insert a screener asset carrying a mismatched org_id/title_id, or one built from the
-- wrong kind of source. Mirroring the existing precedent closes that gap at negligible cost
-- and no behavior change for any caller that already passes a consistent (org, title,
-- master-asset) triple, which every real caller does.
--
-- TABLE GRANTS — NOT IN THE BRIEF, REQUIRED ANYWAY. 20260726000600 measured (on a
-- throwaway rebuild, Supabase CLI 2.109.1) that the platform's current default privilege
-- set no longer grants SELECT/INSERT/UPDATE/DELETE to a freshly created table — every one
-- of the 26 tables that existed at that point needed an explicit GRANT restored, or
-- `authenticated` 403s on every read regardless of RLS. 20260726000900's
-- organization_payout_details — created after it, on the same day — states and follows the
-- identical rule for a brand-new table (`revoke all ... from anon; grant select ... to
-- authenticated; grant select, insert, update ... to service_role;`), which is the
-- confirmation that this is a settled house convention, not a one-off. This migration
-- follows the same shape, except service_role gets SELECT only (see FIX ROUND 1 above for
-- why a write grant there would undermine the whole point of routing writes through
-- register_transcode_output/fail_transcode_job).
--
-- DESTRUCTIVE OPS (approved before apply): CREATE TYPE public.transcode_status. CREATE
-- TABLE public.transcode_jobs (expected_output_key UNIQUE) with three indexes. ENABLE ROW
-- LEVEL SECURITY on it, one SELECT policy. REVOKE ALL from anon; REVOKE INSERT/UPDATE/DELETE
-- from authenticated; REVOKE DELETE from service_role (all writes go through the three
-- functions below, none of which ever deletes). Explicit GRANT SELECT to authenticated and
-- to service_role. CREATE three functions — create_transcode_job (granted to authenticated
-- only), register_transcode_output and fail_transcode_job (both revoked from
-- public/anon/authenticated, granted to service_role only — no client caller exists or ever
-- should). No existing table, row, type, or function is altered or dropped. Forward-only. To
-- roll back: drop the three functions, drop the table, drop the type — no other object
-- depends on any of them.
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
  -- stops a forged event registering an arbitrary S3 key as a screener. UNIQUE (fix round
  -- 1): no two job rows, in any status, may ever share a destination key — see header.
  expected_output_key text not null unique,
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
-- 2. TABLE GRANTS (fix round 1 — see header). anon gets nothing at all. service_role gets
--    SELECT only: both RPCs below are SECURITY DEFINER and run as their owner, so no table-
--    level write grant is needed for either to function, and granting one anyway would let
--    a direct write bypass register_transcode_output's key check entirely.
-- ----------------------------------------------------------------------------
revoke all on public.transcode_jobs from anon;
grant select on public.transcode_jobs to authenticated;
grant select on public.transcode_jobs to service_role;

-- ----------------------------------------------------------------------------
-- 3. RLS — read for the owning org and GC, no client writes. All mutation is via RPC.
--    DELETE is revoked from every role, including service_role (fix round 1): rule 2,
--    nothing here is ever deleted.
-- ----------------------------------------------------------------------------
alter table public.transcode_jobs enable row level security;
revoke insert, update, delete on public.transcode_jobs from authenticated, anon;
revoke delete on public.transcode_jobs from service_role;

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
  -- create_asset's existing precedent for the same class of operation. NOT EXISTS is
  -- three-valued-logic-safe by construction (see FIX ROUND 1's sweep) regardless of a NULL
  -- p_title_id/p_source_asset_id.
  if not exists (select 1 from public.titles t where t.id = p_title_id and t.org_id = p_org_id) then
    raise exception 'Title does not belong to this organization';
  end if;
  if not exists (
    select 1 from public.assets a
    where a.id = p_source_asset_id and a.org_id = p_org_id and a.title_id = p_title_id
      and a.kind = 'master'
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
--    authority check (now null-safe), the row lock, and the screener_source flip reasoning.
-- ----------------------------------------------------------------------------
create or replace function public.register_transcode_output(
  p_job_id       uuid,
  p_storage_key  text,
  p_bytes        bigint,
  p_content_hash text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_job public.transcode_jobs; v_asset_id uuid; v_source public.screener_source;
begin
  -- FOR UPDATE (fix round 1): EventBridge is at-least-once delivery. Without a row lock,
  -- two concurrent deliveries for the same job both read 'submitted', both pass the key
  -- check, and both insert — two immutable, undeletable screener assets sharing a key, one
  -- orphaned forever. The lock serializes them: the second caller blocks until the first
  -- commits, then re-reads the now-'complete' row and takes the idempotent early return.
  select * into v_job from public.transcode_jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found'; end if;

  -- Idempotent: a duplicate EventBridge delivery must not register a second asset.
  if v_job.status = 'complete' then return v_job.output_asset_id; end if;

  -- The key is NOT taken on trust. It must equal what we recorded at submit time.
  -- `is distinct from` (fix round 1 — CRITICAL), not `<>`: p_storage_key can arrive as SQL
  -- NULL from a malformed payload, no attacker required. `btrim(NULL) <> anything` is NULL,
  -- and `if NULL then` does not branch, so a bare `<>` here let a null key walk straight
  -- past the only defence this migration has. `coalesce(..., '')` on the left folds NULL
  -- to '', which can never equal a real (non-blank — enforced at submit time) key, so it is
  -- correctly rejected rather than silently passed through.
  if coalesce(btrim(p_storage_key), '') is distinct from v_job.expected_output_key then
    raise exception 'Output key does not match the job';
  end if;

  -- Fix round 1: matches create_asset's own validation for the same field — refuse a blank
  -- content_hash rather than let it land in an immutable provenance column.
  if coalesce(btrim(p_content_hash), '') = '' then
    raise exception 'content_hash required';
  end if;

  insert into public.assets (org_id, title_id, kind, storage_key, content_hash, bytes, content_type)
  values (v_job.org_id, v_job.title_id, 'screener', v_job.expected_output_key,
          btrim(p_content_hash), coalesce(p_bytes, 0), 'video/mp4')
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

  -- Ids and a boolean only — no storage keys, no filenames, no names, in THIS row. (The
  -- assets INSERT above still fires the pre-existing audit_assets trigger, which writes the
  -- whole assets row — storage_key included — exactly as it does for every asset this app
  -- has ever created; see FIX ROUND 1's header correction. A storage key alone is not a
  -- bearer credential the way portal_links.share_token is.)
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
