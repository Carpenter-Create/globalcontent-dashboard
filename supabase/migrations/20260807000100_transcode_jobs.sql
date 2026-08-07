-- 20260807000100_transcode_jobs.sql
--
-- INTENT: an uploaded master triggers a MediaConvert job that renders a small viewing
-- proxy (the object the buyer-facing screener page actually streams — masters archive to
-- Glacier at 90 days per 111fbbe, and a buyer must never wait on a 5-12h restore mid-pitch).
-- This migration is the job ledger and the two service-role functions that resolve a
-- completion or failure event from that pipeline. Submission (T4) and the callback route
-- (T5) are later slices; this is the record they write to and read from.
--
-- THE OUTPUT KEY IS AUTHORITY, NOT A HINT — FOR THE COMPLETION EVENT. expected_output_key
-- is decided and written at SUBMIT time (create_transcode_job, called from the upload
-- path, which already knows the deterministic key MediaConvert will be told to render to).
-- register_transcode_output never learns a key from the inbound event beyond using it as a
-- claim to verify — it compares the claimed key against what THIS ROW already recorded, and
-- refuses on any mismatch. That single check is what stops a forged completion EVENT (or a
-- MediaConvert account emitting for the wrong job) from registering an arbitrary S3 object
-- as a screener on any title. It is NOT, by itself, a guarantee about the SUBMISSION: until
-- fix round 3 added a scope check (see below), nothing stopped an operate-capable caller of
-- create_transcode_job from supplying a key belonging to a different org or title in the
-- first place. Two different claims, two different checks — stated separately now rather
-- than as one "the key is authority" sentence that only covered one of them.
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
--   Both fixed below. (Fix round 2 replaced this per-verb patch with an unconditional
--   `revoke all` — see FIX ROUND 2.)
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
--   existed under that description. (Fix round 1's chosen mitigation — a flat UNIQUE — was
--   itself replaced in fix round 2; see FIX ROUND 2 for the corrected three-option analysis
--   and why a flat unique was wrong.)
--
--   ALSO FIXED: create_transcode_job's source-asset check didn't verify `kind = 'master'` —
--   a poster or caption could be submitted as a transcode source. Added. (Fix round 2 split
--   this into its own check with its own message — see FIX ROUND 2.)
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
-- FIX ROUND 2 (round 1 survived review; these two items and three smaller ones did not) —
--
--   IMPORTANT: finding 3 (service_role SELECT-only) was NOT actually closed by round 1.
--   Round 1 removed the explicit `grant insert, update ... to service_role` — that removes
--   the EXPLICIT grant, not the IMPLICIT one. Round 1's own header (the TABLE GRANTS note
--   above) already argued correctly that on the founder's production database a new
--   `postgres`-created table arrives with SELECT+INSERT+UPDATE+DELETE for every role,
--   because 20260726000300 subtracted only TRUNCATE/REFERENCES/TRIGGER/MAINTAIN — and then
--   only revoked DELETE from service_role, leaving INSERT and UPDATE untouched. service_role
--   is BYPASSRLS, so the SELECT-only policy does nothing to stop it: on production,
--   service_role kept the ability to `update transcode_jobs set status='complete',
--   output_asset_id='<any asset>'` directly, skipping register_transcode_output's key check
--   entirely — verbatim the threat this migration exists to close. Fixed below by revoking
--   ALL privileges from all three roles UP FRONT, unconditionally, rather than reasoning
--   about which default privilege set the table happened to inherit: `revoke all on
--   public.transcode_jobs from anon, authenticated, service_role;` before any grant. That is
--   deterministic on both platform images — nothing left to guess about — where round 1's
--   per-verb REVOKE list depended on correctly enumerating every verb the ambient default
--   might have handed out, and missed two.
--
--   IMPORTANT: the flat UNIQUE on expected_output_key (fix round 1's choice) was itself
--   wrong — it breaks the retry feature this same plan specifies (Task 7 Step 2). The
--   output key is a pure function of the source master's key (T3 asserts that determinism),
--   so a retry after a failure necessarily recomputes the IDENTICAL key, and a flat unique
--   constraint makes every retry 23505 forever, since the failed job's row is never deleted
--   (rule 2). Round 1's rejection of the OTHER earlier option — a partial unique on
--   `title_id` where status in ('submitted','running') — was correct on its own terms (it
--   only blocks two ACTIVE rows for the same title; a 'failed' job's late, stale event still
--   registers because register_transcode_output only ever excluded `status = 'complete'`,
--   not any terminal state), but round 1 stopped at two options when a third closes both
--   problems at once:
--
--     (a) partial unique on title_id, active statuses only — rejected (round 1): does not
--         stop a failed job's stale event from still registering.
--     (b) flat unique on expected_output_key — rejected (round 2, this pass): stops the
--         double-register, but also permanently blocks any legitimate retry of a failed job,
--         since the row (and its key) is retained forever.
--     (c) partial unique on expected_output_key, active statuses only, COMBINED with
--         tightening register_transcode_output to require the job be ACTIVE
--         (status in ('submitted','running')) rather than merely `status <> 'complete'` —
--         CHOSEN. Walk the exact hazard sequence against it: job1 (key K) fails — its status
--         leaves the partial index's covered set, so it no longer reserves K. A retry, job2
--         (key K, same title), is created — legal, since job1 is not active. job1's stale
--         completion event finally arrives; job1.status is 'failed', which is not in
--         ('submitted','running'), so register_transcode_output now raises 'Job is not
--         active' before ever reaching the key comparison — refused, not registered. job2's
--         own genuine completion event arrives later; job2 is 'submitted' (active), passes
--         every check, registers normally. Exactly one asset. The double-register is closed
--         AND the retry stays legal — the property (b) could not deliver.
--
--   That "exactly one asset" claim was true only for the FAILURE sequence walked above. Fix
--   round 3 found the same hazard reachable from the SUCCESS sequence instead — see FIX
--   ROUND 3 below for the completed walkthrough covering both.
--
--   Implemented as a SEPARATE `create unique index ... where status in (...)` statement
--   AFTER the table, not inline in the column definition — see the next item for why.
--
--   Also, register_transcode_output's terminal handling is now explicit rather than
--   incidental: `status = 'complete'` still returns the existing asset id (idempotent);
--   anything else NOT in ('submitted','running') — i.e. 'failed' or 'submit_failed' — now
--   raises 'Job is not active' rather than silently falling through to the key check. A job
--   GC has explicitly failed, or that AWS itself failed to even submit, is genuinely done;
--   nothing can complete it after the fact except by creating a new job row.
--
--   ALSO: the UNIQUE in fix round 1 was written inline in `create table if not exists
--   public.transcode_jobs (...)`. On any database where an earlier draft of this migration
--   already created the table without it, `if not exists` skips table creation entirely —
--   the constraint is silently never added, while the migration still reports success. Every
--   other statement in this file is its own idempotent `if not exists` / `create or replace`
--   / `drop ... if exists`; this was the one that could land half-applied. The partial index
--   is now its own `create unique index if not exists ...` statement, independent of whether
--   the table already existed.
--
--   ALSO: create_transcode_job's source-asset check folded "wrong title" and "wrong kind"
--   into one EXISTS with one message. A poster that genuinely belongs to the right title hit
--   'Source asset does not belong to this title' — true of the row's title, false of the
--   actual defect, and misleading to whoever reads that error. Split into two checks: the
--   existing message for a title/org mismatch, and a new 'Source asset must be a master
--   asset' for a correctly-scoped asset of the wrong kind.
--
-- FIX ROUND 3 (round 2 verified closed; two more found, one of them one word) —
--
--   IMPORTANT: the partial index's predicate — `where status in ('submitted','running')` —
--   released a job's key the moment it went 'complete', which only closed HALF the
--   double-register hazard. Walk the SUCCESS sequence fix round 2 didn't check: job1 (key K)
--   completes — registers asset A1, flips screener_source, job1 → 'complete' → K is
--   released, because 'complete' was never in the predicate. A retry for the same source
--   asset (Task 4 submits on master-upload completion, so a client re-uploading the same
--   master reproduces the identical deterministic key; Task 6's reconcile can also
--   resubmit) recomputes the same key K. create_transcode_job succeeds — no ACTIVE row holds
--   K anymore. That job's own completion registers asset A2 at the SAME key. assets has no
--   unique index on storage_key, so nothing stops the second insert. portal_resolve_screener
--   resolves the latest by title (`order by created_at desc limit 1`), so a buyer is served
--   A2 while A1 — immutable, never deleted — sits in the table forever describing an S3
--   object MediaConvert has since overwritten: a stale content_hash/bytes pair with no
--   corresponding reality. Exactly the harm fix round 2 named, reached from the opposite
--   direction. Fixed by widening the predicate to `where status in ('submitted','running',
--   'complete')`: a completed job now reserves its key PERMANENTLY, which is correct,
--   because an immutable asset genuinely exists at it and always will. 'failed' and
--   'submit_failed' are the only statuses NOT in the list, so they are still the only ones
--   that release a key — the retry-after-FAILURE path fix round 2 built is untouched: job1
--   fails, leaves the covered set, job2 legally reuses the key, job1's own stale event is
--   still refused by the 'Job is not active' check (status = 'failed' is not in the
--   predicate's list either). Re-verified against all 61 pre-existing assertions rather than
--   assumed — see the task report for the row-by-row check. None change meaning: every
--   assertion that exercises the uniqueness constraint does so while the relevant job is
--   still 'submitted' (never 'complete') at that point in the file, and the one place a
--   'complete' job's key is reused (Block F, job_f) relies on 'failed', not 'complete',
--   which was never affected.
--
--   IMPORTANT: p_expected_output_key is client-supplied to create_transcode_job (granted to
--   `authenticated`) and was accepted as any non-blank string. Nothing enforced the
--   `orgs/<org>/titles/<title>/…` convention src/lib/assets.ts's key-building establishes,
--   so an operate-capable member of org A could submit a job whose key names a DIFFERENT
--   org's or title's master — a forged SUBMISSION, not a forged completion event (the
--   distinction the migration intro now states explicitly). register_transcode_output would
--   still only check the claimed key against what THIS ROW recorded, and this row could
--   already be lying about which object it owns. create_asset has the identical gap and is
--   not fixed here (out of this migration's scope, and a wider change) — but this file is
--   still unapplied, so closing it here is nearly free. Fixed with a scope check in
--   create_transcode_job, after the existing title/asset/blank-key checks (so a title/org
--   mismatch or a blank key still raises its own, more specific message first):
--     `if btrim(p_expected_output_key) not like
--        'orgs/' || p_org_id::text || '/titles/' || p_title_id::text || '/%' then
--        raise exception 'expected_output_key is out of scope for this title';
--      end if;`
--   p_org_id/p_org_id::text and p_title_id::text are both UUIDs at this point (already
--   validated to exist and belong to each other by the checks above), so they can never
--   themselves contain a LIKE wildcard (`%`/`_`) — only the trailing `%` this check adds
--   intentionally is a wildcard, so no escaping is needed.
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
-- identical rule for a brand-new table, which is the confirmation that this is a settled
-- house convention, not a one-off. This migration goes one step further than either
-- precedent (see FIX ROUND 2): rather than granting the assumed-needed verbs and revoking
-- the assumed-unneeded ones per role — which is only as complete as the list of verbs
-- someone thought to enumerate, and round 1 missed two on service_role — it revokes
-- EVERYTHING from every role first, unconditionally, then grants back exactly SELECT to
-- `authenticated` and `service_role`. Deterministic regardless of which default privilege
-- set the table happened to inherit at creation time.
--
-- DESTRUCTIVE OPS (approved before apply): CREATE TYPE public.transcode_status. CREATE
-- TABLE public.transcode_jobs with three indexes, plus a separate partial UNIQUE INDEX on
-- expected_output_key (submitted/running/complete — everything except the two failure
-- statuses; see FIX ROUND 3). ENABLE ROW LEVEL SECURITY on it, one SELECT policy. REVOKE
-- ALL on the table from anon, authenticated, AND service_role, unconditionally, before
-- granting anything back (all writes go through the three functions below, none of which
-- ever deletes). Explicit GRANT SELECT to authenticated and to service_role — no other
-- verb, to either. CREATE three functions — create_transcode_job (granted to authenticated
-- only; now also scope-checks its own p_expected_output_key argument against p_org_id/
-- p_title_id — see FIX ROUND 3), register_transcode_output and fail_transcode_job (both
-- revoked from public/anon/authenticated, granted to service_role only — no client caller
-- exists or ever should). No existing table, row, type, or function is altered or dropped.
-- Forward-only. NOTE: unlike every other statement in this migration, the unique index's
-- predicate is not something that can be safely changed after the fact without downtime —
-- altering it means dropping and recreating the index on a live table. Get the predicate
-- right before this is ever applied; it is right as of fix round 3. To roll back: drop the
-- three functions, drop the table, drop the type — no other object depends on any of them.
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
  -- stops a forged event registering an arbitrary S3 key as a screener (create_transcode_job
  -- separately scope-checks the value itself against org_id/title_id — fix round 3 — since
  -- this column has no defense of its own against a forged SUBMISSION). Uniqueness is
  -- enforced by a separate partial index below (fix round 2, predicate widened in fix round
  -- 3), not inline here — see header.
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

-- Fix round 2: a SEPARATE, idempotent statement — not inline in the table definition above
-- — so it cannot be silently skipped if `create table if not exists` finds the table
-- already there from an earlier draft. Partial, not flat: see FIX ROUND 2 for why a flat
-- unique blocks the legitimate retry-after-failure path.
--
-- PREDICATE (fix round 3 widened this from 'submitted','running' to also include
-- 'complete'): a job reserves its key for as long as that key legitimately describes real
-- or eventual state — which is true while the job is in flight AND after it has completed,
-- since an immutable asset now exists at that key and always will. Only 'failed' and
-- 'submit_failed' release it, because those are the only two outcomes where no asset was
-- ever created and the key is free to be tried again by a resubmission. The index name says
-- "active" for historical reasons (fix round 2's original, narrower predicate); the
-- predicate itself is the source of truth — read it, not the name.
create unique index if not exists transcode_jobs_active_key_uidx
  on public.transcode_jobs (expected_output_key)
  where status in ('submitted', 'running', 'complete');

-- ----------------------------------------------------------------------------
-- 2. TABLE GRANTS (fix round 2 — see header). Unconditional `revoke all` first, then grant
--    back exactly SELECT to authenticated and service_role. anon gets nothing at all.
--    service_role gets SELECT only: both RPCs below are SECURITY DEFINER and run as their
--    owner, so no table-level write grant is needed for either to function, and granting
--    one anyway — explicitly or by leaving an implicit one in place, round 1's mistake —
--    would let a direct write bypass register_transcode_output's key check entirely.
-- ----------------------------------------------------------------------------
revoke all on public.transcode_jobs from anon, authenticated, service_role;
grant select on public.transcode_jobs to authenticated;
grant select on public.transcode_jobs to service_role;

-- ----------------------------------------------------------------------------
-- 3. RLS — read for the owning org and GC, no client writes. All mutation is via RPC. No
--    role holds INSERT/UPDATE/DELETE on this table at all (see grants above), so there is
--    nothing further to revoke here.
-- ----------------------------------------------------------------------------
alter table public.transcode_jobs enable row level security;

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
  ) then
    raise exception 'Source asset does not belong to this title';
  end if;
  -- Fix round 2: a SEPARATE check with its own message. Folded into the check above, a
  -- poster or caption that genuinely belongs to the right title would have raised "does not
  -- belong to this title" -- true of the row, false of the actual defect (wrong kind).
  if not exists (select 1 from public.assets a where a.id = p_source_asset_id and a.kind = 'master') then
    raise exception 'Source asset must be a master asset';
  end if;

  if coalesce(btrim(p_expected_output_key), '') = '' then
    raise exception 'expected_output_key required';
  end if;

  -- Fix round 3: the key is client-supplied and becomes the sole authority
  -- register_transcode_output later trusts for what object to register. Without this,
  -- an operate-capable member of org A could submit a job whose key names a DIFFERENT
  -- org's or title's master (create_asset has the identical gap; not fixed there in this
  -- migration, but this file is still unapplied and closing it here is nearly free). This
  -- stops a forged SUBMISSION -- a different guarantee from register_transcode_output's own
  -- check below, which stops a forged completion EVENT against an already-recorded key (see
  -- migration intro). p_org_id/p_title_id are UUIDs already validated above, so they cannot
  -- themselves contain a LIKE wildcard; only the trailing `%` this pattern adds is one.
  if btrim(p_expected_output_key) not like
       'orgs/' || p_org_id::text || '/titles/' || p_title_id::text || '/%' then
    raise exception 'expected_output_key is out of scope for this title';
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

  -- Fix round 2: the only other terminal states are 'failed' and 'submit_failed' -- a job
  -- GC explicitly failed, or one AWS never even accepted, is genuinely done. Requiring the
  -- job be ACTIVE here (not merely "not complete") is the other half of what makes the
  -- partial unique index above safe: only 'failed'/'submit_failed' ever leave that index's
  -- covered set (fix round 3 widened the predicate to also cover 'complete', since a
  -- completed job's key must stay reserved forever -- an immutable asset already exists at
  -- it), so this check is what stops a FAILED job's own late, stale completion event from
  -- registering against a key its failure has freed up for a retry to legally reuse.
  if v_job.status not in ('submitted', 'running') then
    raise exception 'Job is not active';
  end if;

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
