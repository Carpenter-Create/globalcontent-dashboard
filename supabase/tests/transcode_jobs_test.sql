-- transcode_jobs_test.sql
--
-- 20260807000100 adds transcode_jobs (the MediaConvert job ledger for the master->proxy
-- pipeline) and its three RPCs: create_transcode_job (authenticated, operate-gated, called
-- from the upload path), register_transcode_output (service_role ONLY -- the
-- security-critical one: it is what registers the asset a buyer-facing screener link will
-- serve), and fail_transcode_job (service_role ONLY).
--
-- Covered below, in blocks:
--   A. create_transcode_job -- a viewer seat cannot create a job; a member of a wholly
--      different org cannot create one for this org; an operate-capable owner can; the
--      tenant-consistency guard this migration adds beyond the brief's literal SQL (title
--      must belong to the org, source asset must belong to that title -- mirroring
--      create_asset's existing precedent) fires on both a cross-org title and a
--      wrong-title asset; a blank expected_output_key is refused.
--   B. register_transcode_output -- NOT executable by `authenticated` at the grant level
--      (permission denied, checked before any argument/fixture lookup); a storage_key that
--      does not equal the job's own expected_output_key is refused and leaves the job
--      untouched (the single check that stops a forged completion event from registering
--      an arbitrary S3 object as a screener); a correct call flips a 'master'-source
--      title to 'dedicated', creates exactly one screener asset, marks the job complete,
--      and writes one audit_log row carrying only {asset_id, flipped_source} -- checked
--      both for the correct values AND for the absence of storage_key / the job's own
--      expected_output_key / original_filename (the regression this repo has been burned
--      by before: a whole-row trigger leaking a live credential/key into the
--      append-only, unpurgeable audit_log -- 20260806000400's own header); a duplicate
--      completion (different bytes/hash, simulating a re-delivered event) is idempotent --
--      same asset id, no second asset row, no second audit row, and the original asset's
--      bytes/content_hash are provably untouched by the duplicate's payload; an unknown
--      job id is refused.
--   C. The screener_source flip boundary's other half -- a title already 'dedicated'
--      (an explicit client choice) stays 'dedicated' through a successful registration,
--      and the audit row records flipped_source = false.
--   D. fail_transcode_job -- NOT executable by `authenticated` (same boundary as B); a
--      valid call sets status/failure_reason; a second call while still not-'complete'
--      is accepted (a later Lambda retry re-reporting failure, possibly with a different
--      reason -- the guard only ever excludes 'complete', by design); calling it on a
--      job that is already 'complete' is refused, and that job's status is provably
--      untouched by the refusal; an unknown job id is refused with the same message.
--   E. RLS -- an org member (any view-capable role, including a bare viewer) sees the
--      org's own jobs; GC (gc_can 'view') sees them too; a member of a completely
--      different org sees none. This also stands in as the regression test for the
--      table-level GRANT this migration adds beyond the brief (20260726000600 found that a
--      table created on the current platform image arrives with NO default
--      SELECT/INSERT/UPDATE/DELETE for `authenticated` -- without the explicit
--      `grant select ... to authenticated` in the migration, every read below would 403
--      before RLS is ever evaluated, correct policy or not).
--
-- IDENTITY DISCIPLINE: set_config('request.jwt.claims', ..., true) is transaction-local
-- and leaks forward, so every block below sets the identity it needs and nothing is
-- assumed to still be set from a prior block.
--
-- THE now() TRAP: audit_log.at defaults to now(), identical for every row in this whole
-- transaction. Every audit_log lookup below filters on entity_id (each job is registered
-- at most once -- register_transcode_output's own idempotency guarantees that -- so
-- entity_id + action always identifies at most one row here, with no need for
-- order-by/limit disambiguation at all).
--
-- FIX ROUND 1 additions (migration header has the full reasoning for each):
--   - t.job_n + a NULL p_storage_key call: the CRITICAL fix (`is distinct from`, not `<>`).
--   - a second create_transcode_job call reusing job_m's own expected_output_key: the
--     uniqueness constraint (23505; partial as of round 2 -- see below).
--   - t.asset_poster_m (kind='poster') as a source: the new kind check.
--   - direct INSERT/UPDATE/DELETE against transcode_jobs as `authenticated`: the table-grant
--     regression this repo has a standing idiom for (assets_test.sql:47-50).
--   - a bare SELECT as `anon`: proves the explicit `revoke all ... from anon` holds (this is
--     exactly where a missing revoke hides on production -- silent on a from-scratch
--     rebuild, present on prod).
--
-- FIX ROUND 2 additions (migration header, FIX ROUND 2, has the full reasoning):
--   - service_role direct INSERT/UPDATE/DELETE against transcode_jobs, alongside the
--     existing `authenticated` version: round 1's per-verb revoke missed INSERT/UPDATE on
--     service_role on an image where CREATE TABLE hands out the full set by default (the
--     founder's production database) -- service_role is BYPASSRLS, so this is the one role
--     where a missed revoke is a live bypass of the whole migration's point, not a no-op.
--   - block F: job_f (block D) fails, then a NEW job legally reuses its key (the partial
--     index only covers active statuses), the OLD failed job's own late/stale completion is
--     refused ('Job is not active'), and the retry's genuine completion registers once. This
--     is the retry-after-failure path the flat unique (round 1) would have made permanently
--     23505 -- Task 7 Step 2 of this plan depends on it staying legal.
--   - A11's expected message changes to the new, more specific 'Source asset must be a
--     master asset' (previously the misleading 'does not belong to this title').
-- Block F adds a fifth job (t.job_f_retry) to org A, so block E's row counts move from 4 to 5.
--
-- FIX ROUND 3 additions (migration header, FIX ROUND 3, has the full reasoning):
--   - job_m/job_d/job_f/job_n's expected_output_key literals are now precomputed from the
--     REAL org_id/title_id UUIDs (t.key_m/t.key_d/t.key_f/t.key_n), not the human-readable
--     shorthand ('orgs/a/titles/m/...') used everywhere else in this file for asset
--     storage_key fixtures. create_transcode_job now scope-checks its own
--     p_expected_output_key argument against p_org_id/p_title_id, so every key that must
--     pass through it (every successful create_transcode_job call, plus the matching
--     register_transcode_output calls that reuse the same value) needs to actually satisfy
--     that check. Keys used only where the function raises BEFORE reaching the scope check
--     (A1/A2/A5/A6/A7/A11, and anything that bypasses the RPC entirely) are untouched.
--   - A10b: a key naming a different org/title's path is refused even when the title/asset
--     checks all pass -- the new scope check itself.
--   - A new assertion after B4: job_m is 'complete', and the partial index now also covers
--     'complete' (not just 'submitted'/'running'), so a second job still cannot reuse its
--     key -- proving the predicate widening that closes the success-path double-register
--     fix round 2 missed.
-- plan(61) -> plan(63): one assertion for each of the two items above.
--
-- FIX ROUND 4 additions (migration header, FIX ROUND 4, has the full reasoning):
--   - the complete-job key-reuse assertion above was added under `service_role`, which has
--     no execute grant on create_transcode_job at all -- it would have 42501'd before ever
--     reaching the uniqueness constraint, testing nothing. Now switches to `authenticated`
--     (matching Block F's existing pattern) for that one call, then switches straight back
--     to `service_role`, since the audit_log reads and duplicate-completion call right
--     after it still need that role. Re-checked every other function call in this file
--     against the role active at that point; this was the only one running under a role
--     that cannot execute what it calls (the several places `authenticated`/`service_role`
--     deliberately call a function they're NOT granted, to assert 42501, are correct by
--     design, not instances of this bug).
--   - t.key_m/t.key_d/t.key_f/t.key_n now use `/screener/` as the kind segment, not
--     `/proxy/` -- the scope check tightened in fix round 4 anchors on the 'screener' kind,
--     matching the kind register_transcode_output actually inserts assets as.
--   - A10c: a key correctly scoped to org/title but naming the 'master' kind segment
--     instead of 'screener' is refused -- the new anchor this round adds.
--   - the reachability comment above (and the migration header) corrected: a client
--     RE-UPLOADING the same master does NOT reproduce the same key (assetKey() mints a
--     fresh UUID per upload); the actual reachable path is a resubmission against the SAME
--     assets row (Task 6 reconcile, Task 7 retry, or a duplicate Task 4 submission).
-- plan(63) -> plan(64): one new assertion (A10c); the role-switch fix adds no new
-- assertion, only corrects which role the existing one runs under.

begin;
select plan(64);

-- ============================================================================
-- fixtures (as superuser / owner)
-- ============================================================================
select set_config('t.org',      gen_random_uuid()::text, false);
select set_config('t.org_b',    gen_random_uuid()::text, false);
select set_config('t.owner',    gen_random_uuid()::text, false);
select set_config('t.viewer',   gen_random_uuid()::text, false);
select set_config('t.gc',       gen_random_uuid()::text, false);
select set_config('t.owner_b',  gen_random_uuid()::text, false);
select set_config('t.title_m',  gen_random_uuid()::text, false);  -- screener_source default 'master'
select set_config('t.title_d',  gen_random_uuid()::text, false);  -- screener_source 'dedicated'
select set_config('t.title_b',  gen_random_uuid()::text, false);  -- org B's title, for the cross-org guard
select set_config('t.asset_m',  gen_random_uuid()::text, false);  -- master asset for title_m
select set_config('t.asset_d',  gen_random_uuid()::text, false);  -- master asset for title_d

insert into auth.users (id) values
  (current_setting('t.owner')::uuid), (current_setting('t.viewer')::uuid),
  (current_setting('t.gc')::uuid), (current_setting('t.owner_b')::uuid);

insert into public.organizations (id, name, status) values
  (current_setting('t.org')::uuid,   'Org A', 'active'),
  (current_setting('t.org_b')::uuid, 'Org B', 'active');

insert into public.memberships (user_id, org_id, role) values
  (current_setting('t.owner')::uuid,   current_setting('t.org')::uuid,   'account_owner'),
  (current_setting('t.viewer')::uuid,  current_setting('t.org')::uuid,   'viewer'),
  (current_setting('t.owner_b')::uuid, current_setting('t.org_b')::uuid, 'account_owner');

insert into public.gc_staff (user_id, role) values
  (current_setting('t.gc')::uuid, 'gc_delivery_ops');

insert into public.titles (id, org_id, title, status) values
  (current_setting('t.title_m')::uuid, current_setting('t.org')::uuid,   'Film Master',    'in_delivery');
insert into public.titles (id, org_id, title, status, screener_source) values
  (current_setting('t.title_d')::uuid, current_setting('t.org')::uuid,   'Film Dedicated', 'in_delivery', 'dedicated');
insert into public.titles (id, org_id, title, status) values
  (current_setting('t.title_b')::uuid, current_setting('t.org_b')::uuid, 'Org B Film',     'in_delivery');

insert into public.assets (id, org_id, title_id, kind, storage_key, content_hash, bytes) values
  (current_setting('t.asset_m')::uuid, current_setting('t.org')::uuid, current_setting('t.title_m')::uuid,
   'master', 'orgs/a/titles/m/master/film.mov', 'aaaa1111', 100000),
  (current_setting('t.asset_d')::uuid, current_setting('t.org')::uuid, current_setting('t.title_d')::uuid,
   'master', 'orgs/a/titles/d/master/film.mov', 'bbbb2222', 100000);

-- Fix round 1: a non-master asset on title_m, to prove create_transcode_job's new
-- `and a.kind = 'master'` guard actually excludes it as a transcode source.
select set_config('t.asset_poster_m', gen_random_uuid()::text, false);
insert into public.assets (id, org_id, title_id, kind, storage_key, content_hash, bytes) values
  (current_setting('t.asset_poster_m')::uuid, current_setting('t.org')::uuid, current_setting('t.title_m')::uuid,
   'poster', 'orgs/a/titles/m/poster/key.jpg', 'cccc3333', 500);

-- Fix round 3, finding 2 (anchor tightened in fix round 4): create_transcode_job now
-- scope-checks expected_output_key against the REAL org_id/title_id UUIDs AND the
-- 'screener' kind segment (`orgs/<org>/titles/<title>/screener/...`), so every key that
-- must pass through it below is precomputed here from the actual fixture UUIDs, not a
-- human-readable shorthand -- unlike the asset storage_key fixtures above (e.g.
-- 'orgs/a/titles/m/poster/key.jpg'), which never flow through that check and stay
-- shorthand on purpose, for readability. Precomputed once so every later
-- register_transcode_output call for the same job can reuse the identical value.
select set_config('t.key_m',
  'orgs/' || current_setting('t.org') || '/titles/' || current_setting('t.title_m') || '/screener/out_m.mp4', false);
select set_config('t.key_d',
  'orgs/' || current_setting('t.org') || '/titles/' || current_setting('t.title_d') || '/screener/out_d.mp4', false);
select set_config('t.key_f',
  'orgs/' || current_setting('t.org') || '/titles/' || current_setting('t.title_m') || '/screener/out_f.mp4', false);
select set_config('t.key_n',
  'orgs/' || current_setting('t.org') || '/titles/' || current_setting('t.title_m') || '/screener/out_n.mp4', false);

-- ============================================================================
-- A. create_transcode_job
-- ============================================================================
set local role authenticated;

-- A1: a viewer has 'view' but not 'operate' -- member_can's operate branch excludes it.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewer'), 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_m'), 'orgs/a/titles/m/proxy/x.mp4'),
  'P0001', 'Not authorized', 'a viewer seat cannot create a transcode job');

-- A2: owner_b operates org B, not org A -- member_can(uid, org_A, 'operate') has no
-- membership row to match at all, regardless of what owner_b can do in their own org.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner_b'), 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_m'), 'orgs/a/titles/m/proxy/x.mp4'),
  'P0001', 'Not authorized', 'a member of a different org cannot create a job for this org');

-- A3: the owner operates org A and title_m/asset_m are a consistent (org, title, asset)
-- triple -- succeeds.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_m'), current_setting('t.key_m')),
  'operate-capable owner creates a transcode job for their own org');
select set_config('t.job_m',
  (select id::text from public.transcode_jobs where expected_output_key = current_setting('t.key_m')), false);
select is(
  (select status::text from public.transcode_jobs where id = current_setting('t.job_m')::uuid),
  'submitted', 'a freshly created job starts in status submitted');

-- A5 (tenant-consistency guard, added beyond the brief -- mirrors create_asset's own
-- precedent): p_org_id is org A (owner operates it), but p_title_id belongs to org B.
select throws_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_b'), current_setting('t.asset_m'), 'orgs/a/titles/m/proxy/bad1.mp4'),
  'P0001', 'Title does not belong to this organization',
  'a title from a different org is refused even though the caller operates the named org');

-- A6: title_m is correctly org A's, but asset_d belongs to title_d, not title_m.
select throws_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_d'), 'orgs/a/titles/m/proxy/bad2.mp4'),
  'P0001', 'Source asset does not belong to this title',
  'a source asset belonging to a different title on the same org is refused');

-- A7: a whitespace-only expected_output_key is not a key.
select throws_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_m'), '   '),
  'P0001', 'expected_output_key required', 'a blank expected_output_key is refused');

-- A8: a second, isolated job on the already-'dedicated' title_d, for block C below.
select lives_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_d'), current_setting('t.asset_d'), current_setting('t.key_d')),
  'owner creates a job for the already-dedicated title');
select set_config('t.job_d',
  (select id::text from public.transcode_jobs where expected_output_key = current_setting('t.key_d')), false);

-- A9: a third job on title_m, left uncompleted, for the fail_transcode_job block below.
select lives_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_m'), current_setting('t.key_f')),
  'owner creates a third job, left uncompleted for the fail_transcode_job block');
select set_config('t.job_f',
  (select id::text from public.transcode_jobs where expected_output_key = current_setting('t.key_f')), false);

-- A10 (fix round 2): expected_output_key's uniqueness is now a PARTIAL index (submitted /
-- running / complete, per fix round 3), not a flat one -- but job_m is still 'submitted'
-- (covered by the index) at this point in the file, so it still occupies its key and a
-- second job cannot reuse it. (Block F, after job_f fails, proves the other half: a FAILED
-- job's key becomes reusable. The complete-job assertion after B4 below proves the third:
-- a job's key stays reserved forever once it COMPLETES, not just while active.)
select throws_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_m'), current_setting('t.key_m')),
  '23505', null, 'a second job cannot reuse a SUBMITTED job''s expected_output_key');

-- A10b (fix round 3, finding 2): expected_output_key must be scoped to the SAME org/title
-- the job is being created for. title_m/asset_m/org are all mutually consistent here (the
-- checks above this one all pass), so this isolates the NEW scope check specifically: the
-- key names org_b/title_b's path instead of org/title_m's.
select throws_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_m'),
         'orgs/' || current_setting('t.org_b') || '/titles/' || current_setting('t.title_b') || '/screener/out_scope.mp4'),
  'P0001', 'expected_output_key is out of scope for this title',
  'a key naming a different org/title''s path is refused even though the title/asset checks pass');

-- A10c (fix round 4): the scope check anchors on the 'screener' kind segment, not merely
-- the title-level prefix. org/title/asset are all correct here (same as A10b's setup) --
-- only the kind segment is wrong ('master' instead of 'screener'), which is exactly the
-- hazard fix round 4 named: without this, an operate-capable member could name their OWN
-- org's MASTER as the transcode output target and have MediaConvert overwrite it.
select throws_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_m'),
         'orgs/' || current_setting('t.org') || '/titles/' || current_setting('t.title_m') || '/master/out_wrong_kind.mp4'),
  'P0001', 'expected_output_key is out of scope for this title',
  'a key correctly scoped to org/title but pointing at the master kind segment is refused');

-- A11 (fix round 1, message split in fix round 2): source_asset_id must be kind = 'master'.
-- asset_poster_m is a real asset on title_m, correctly org-scoped -- only its kind is
-- wrong, so this proves the dedicated kind check and its own distinct message, not the
-- title/org check above it (which would misleadingly claim the asset "doesn't belong").
select throws_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_poster_m'), 'orgs/a/titles/m/proxy/bad3.mp4'),
  'P0001', 'Source asset must be a master asset',
  'a non-master asset (poster) is refused as a transcode source, with its own message');

-- A12: a fourth job on title_m, left uncompleted, for the NULL-storage-key test in block B.
select lives_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_m'), current_setting('t.key_n')),
  'owner creates a fourth job, target of the NULL-storage-key test');
select set_config('t.job_n',
  (select id::text from public.transcode_jobs where expected_output_key = current_setting('t.key_n')), false);

-- A13 (fix round 1, test gap): direct writes are blocked at the table-grant level regardless
-- of RLS -- mirrors assets_test.sql:47-50's idiom for the same class of check. Values are
-- dummy/nonsensical on purpose: permission is checked before any constraint or row is
-- evaluated, so these fail on the grant, never on a foreign key.
select throws_ok(
  $$ insert into public.transcode_jobs (org_id, title_id, source_asset_id, expected_output_key)
     values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'direct-insert-attempt') $$,
  '42501', null, 'authenticated cannot INSERT into transcode_jobs directly');
select throws_ok(
  $$ update public.transcode_jobs set status = 'failed' $$,
  '42501', null, 'authenticated cannot UPDATE transcode_jobs directly');
select throws_ok(
  $$ delete from public.transcode_jobs $$,
  '42501', null, 'authenticated cannot DELETE transcode_jobs directly');

-- ============================================================================
-- B. register_transcode_output
-- ============================================================================

-- B1: permission denied at the grant level, checked before any job lookup -- dummy args
-- are fine. Still under an authenticated identity (owner) from block A.
select throws_ok(
  $$ select public.register_transcode_output(gen_random_uuid(), 'x', 1, 'x') $$,
  '42501', null, 'authenticated cannot execute register_transcode_output');

reset role;
set local role service_role;

-- Fix round 2, finding 1: service_role must be equally unable to write this table directly
-- -- round 1's per-verb revoke missed INSERT/UPDATE on this role on an image where CREATE
-- TABLE hands out the full privilege set by default (the founder's production database).
-- The migration now revokes ALL from every role up front and grants back SELECT only, so
-- this holds regardless of which default privilege set the table happened to inherit.
select throws_ok(
  $$ insert into public.transcode_jobs (org_id, title_id, source_asset_id, expected_output_key)
     values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'service-role-direct-insert') $$,
  '42501', null, 'service_role cannot INSERT into transcode_jobs directly');
select throws_ok(
  $$ update public.transcode_jobs set status = 'failed' $$,
  '42501', null, 'service_role cannot UPDATE transcode_jobs directly (the exact path that would have let a direct write skip the key check)');
select throws_ok(
  $$ delete from public.transcode_jobs $$,
  '42501', null, 'service_role cannot DELETE transcode_jobs directly');

-- B2: the claimed key does not equal job_m's own expected_output_key -- the authority
-- check. job_m is still 'submitted' at this point (only created, never registered).
select throws_ok(
  format($$ select public.register_transcode_output(%L, %L, %L, %L) $$,
         current_setting('t.job_m'), 'this-does-not-match-any-jobs-key.mp4', 1000, 'hash1'),
  'P0001', 'Output key does not match the job', 'a mismatched output key is refused');
select is(
  (select status::text from public.transcode_jobs where id = current_setting('t.job_m')::uuid),
  'submitted', 'job_m is untouched by the refused mismatched-key attempt');

-- B3 (fix round 1, CRITICAL): a NULL storage_key must not walk past the authority check.
-- `coalesce(btrim(NULL), '') is distinct from job_n.expected_output_key` -- '' is distinct
-- from a real (non-blank) key -- correctly raises, where the old `btrim(NULL) <> key` was
-- SQL NULL and `if NULL then` silently fell through to the insert. job_n is still
-- 'submitted' at this point (created in A12, never touched since).
select throws_ok(
  format($$ select public.register_transcode_output(%L, NULL, 100, 'hash_n') $$, current_setting('t.job_n')),
  'P0001', 'Output key does not match the job', 'a NULL storage_key is refused, not silently accepted');
select is(
  (select status::text from public.transcode_jobs where id = current_setting('t.job_n')::uuid),
  'submitted', 'job_n is untouched by the refused null-key attempt');

-- B4: the correct key succeeds. title_m starts at screener_source default 'master' (never
-- set otherwise in this file), so this call also exercises the flip.
select lives_ok(
  format($$ select public.register_transcode_output(%L, %L, %L, %L) $$,
         current_setting('t.job_m'), current_setting('t.key_m'), 1000, 'hash1'),
  'service_role registers job_m''s output');
select set_config('t.output_asset_m',
  (select output_asset_id::text from public.transcode_jobs where id = current_setting('t.job_m')::uuid), false);

select is(
  (select status::text from public.transcode_jobs where id = current_setting('t.job_m')::uuid),
  'complete', 'job_m is marked complete after a successful registration');
select is(
  (select screener_source::text from public.titles where id = current_setting('t.title_m')::uuid),
  'dedicated', 'a master-source title flips to dedicated on successful registration');
select is(
  (select kind::text from public.assets where id = current_setting('t.output_asset_m')::uuid),
  'screener', 'the registered asset has kind screener');
select is(
  (select storage_key from public.assets where id = current_setting('t.output_asset_m')::uuid),
  current_setting('t.key_m'), 'the registered asset''s storage_key is the job''s expected_output_key');
select is(
  (select count(*) from public.assets where title_id = current_setting('t.title_m')::uuid and kind = 'screener')::int,
  1, 'exactly one screener asset exists for title_m');

-- Fix round 3, finding 1: job_m is now 'complete', and the partial index's predicate was
-- widened to cover 'complete' as well as 'submitted'/'running' -- a completed job's key
-- must stay reserved forever, since an immutable asset already exists at it. Without this
-- widening, a resubmission against the SAME source asset (asset_m) -- e.g. Task 6's
-- reconcile, or a duplicate Task 4 submission for this asset id; NOT a re-upload, since
-- assetKey() mints a fresh UUID per upload and a second upload would never reproduce this
-- key -- would have been legal here and could register a SECOND asset at the same key --
-- the harm fix round 2 closed from the failure direction, reachable from the success
-- direction instead.
--
-- Fix round 4: create_transcode_job is authenticated-only. The current role here is
-- service_role (set for block B since B2), which has no execute grant on it at all -- a
-- bare service_role call would 42501 before ever reaching the uniqueness constraint,
-- testing nothing. Switch to authenticated (matching Block F's own pattern below) for this
-- one call, then switch straight back, since the audit_log reads and the
-- duplicate-completion register_transcode_output call right after this still need
-- service_role.
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_m'), current_setting('t.key_m')),
  '23505', null, 'a second job cannot reuse a COMPLETE job''s expected_output_key either');

reset role;
set local role service_role;

-- Audit: ids and a boolean only. entity_id = job_m + action = 'proxy_registered' matches
-- exactly one row -- register_transcode_output writes it once, and the idempotent
-- duplicate below is proven NOT to write a second one.
select is(
  (select (after->>'asset_id')::uuid from public.audit_log
     where entity = 'transcode_jobs' and entity_id = current_setting('t.job_m')::uuid and action = 'proxy_registered'),
  current_setting('t.output_asset_m')::uuid, 'the audit row records the registered asset_id');
select is(
  (select (after->>'flipped_source')::boolean from public.audit_log
     where entity = 'transcode_jobs' and entity_id = current_setting('t.job_m')::uuid and action = 'proxy_registered'),
  true, 'the audit row records flipped_source = true for the master-source title');
select is(
  (select (after ? 'storage_key') from public.audit_log
     where entity = 'transcode_jobs' and entity_id = current_setting('t.job_m')::uuid and action = 'proxy_registered'),
  false, 'the audit row never carries storage_key');
select is(
  (select (after ? 'expected_output_key') from public.audit_log
     where entity = 'transcode_jobs' and entity_id = current_setting('t.job_m')::uuid and action = 'proxy_registered'),
  false, 'the audit row never carries expected_output_key');
select is(
  (select (after ? 'original_filename') from public.audit_log
     where entity = 'transcode_jobs' and entity_id = current_setting('t.job_m')::uuid and action = 'proxy_registered'),
  false, 'the audit row never carries a filename');

-- Idempotency: a duplicate completion (different bytes/hash, as a re-delivered event with
-- the same or a stale payload would look) must return the SAME asset id, create no second
-- asset, write no second audit row, and must not mutate the already-registered asset.
-- Calling the function directly inside is() is safe here: job_m.status is now 'complete',
-- so the function's very first branch (`if v_job.status = 'complete' then return
-- v_job.output_asset_id; end if;`) returns before the key check or any write -- there is
-- no path from here to an exception.
select is(
  (select public.register_transcode_output(current_setting('t.job_m')::uuid,
     current_setting('t.key_m'), 999, 'hash2')::text),
  current_setting('t.output_asset_m'), 'a duplicate completion returns the same asset id');
select is(
  (select count(*) from public.assets where title_id = current_setting('t.title_m')::uuid and kind = 'screener')::int,
  1, 'a duplicate completion creates no second screener asset');
select is(
  -- ::int on the left, not ::bigint on the right: pgTAP's is() is is(anyelement,
  -- anyelement, text), so BOTH sides must resolve to the same type. assets.bytes is
  -- bigint and an unadorned 1000 is integer, which matches no overload and aborts the
  -- whole file at this statement. Every other count assertion here already casts ::int
  -- for exactly this reason; this one was missed.
  (select bytes from public.assets where id = current_setting('t.output_asset_m')::uuid)::int,
  1000, 'a duplicate completion does not overwrite the original asset''s bytes');
select is(
  (select count(*) from public.audit_log
     where entity = 'transcode_jobs' and entity_id = current_setting('t.job_m')::uuid and action = 'proxy_registered')::int,
  1, 'a duplicate completion writes no second audit row');

-- Unknown job id.
select throws_ok(
  $$ select public.register_transcode_output(gen_random_uuid(), 'whatever', 1, 'x') $$,
  'P0001', 'Job not found', 'registering against an unknown job id is refused');

-- ============================================================================
-- C. screener_source flip boundary -- the other half: an explicit 'dedicated' choice
--    survives a successful registration.
-- ============================================================================
select lives_ok(
  format($$ select public.register_transcode_output(%L, %L, %L, %L) $$,
         current_setting('t.job_d'), current_setting('t.key_d'), 500, 'hashD'),
  'service_role registers job_d''s output on an already-dedicated title');
select is(
  (select screener_source::text from public.titles where id = current_setting('t.title_d')::uuid),
  'dedicated', 'a title already dedicated is not disturbed by a successful registration');
select is(
  (select (after->>'flipped_source')::boolean from public.audit_log
     where entity = 'transcode_jobs' and entity_id = current_setting('t.job_d')::uuid and action = 'proxy_registered'),
  false, 'the audit row records flipped_source = false when the title was already dedicated');

-- ============================================================================
-- D. fail_transcode_job
-- ============================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.fail_transcode_job(%L) $$, current_setting('t.job_f')),
  '42501', null, 'authenticated cannot execute fail_transcode_job');

reset role;
set local role service_role;

select lives_ok(
  format($$ select public.fail_transcode_job(%L, %L) $$, current_setting('t.job_f'), 'MediaConvert error XYZ'),
  'service_role fails job_f with a reason');
select is(
  (select status::text from public.transcode_jobs where id = current_setting('t.job_f')::uuid),
  'failed', 'job_f status is failed');
select is(
  (select failure_reason from public.transcode_jobs where id = current_setting('t.job_f')::uuid),
  'MediaConvert error XYZ', 'job_f failure_reason is recorded');

-- A second failure call while still not-'complete' is accepted (the guard only ever
-- excludes 'complete' jobs) -- a later retry re-reporting failure, this time without a
-- reason, clears it.
select lives_ok(
  format($$ select public.fail_transcode_job(%L) $$, current_setting('t.job_f')),
  'a second fail call on a still-not-complete job is accepted, not refused');
select is(
  (select failure_reason from public.transcode_jobs where id = current_setting('t.job_f')::uuid),
  null, 'omitting the reason on the second call clears failure_reason');

-- A job that is already 'complete' cannot be failed.
select throws_ok(
  format($$ select public.fail_transcode_job(%L) $$, current_setting('t.job_m')),
  'P0001', 'Job not found or already complete', 'an already-complete job cannot be failed');
select is(
  (select status::text from public.transcode_jobs where id = current_setting('t.job_m')::uuid),
  'complete', 'job_m''s complete status is untouched by the refused fail attempt');

-- Unknown job id.
select throws_ok(
  $$ select public.fail_transcode_job(gen_random_uuid()) $$,
  'P0001', 'Job not found or already complete', 'failing an unknown job id is refused');

-- ============================================================================
-- F. Retry after failure (fix round 2, finding 2). job_f is 'failed' from block D above
--    (key t.key_f) and was never touched since. This proves the
--    exact three-step sequence the migration header walks through: (1) a retry reusing the
--    failed job's key is legal, because a failed job no longer occupies the partial index;
--    (2) the OLD failed job's own late/stale completion event is refused outright, not
--    silently re-registered, now that register_transcode_output requires an ACTIVE job;
--    (3) the retry's own genuine completion registers exactly once.
-- ============================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_m'),
         current_setting('t.key_f')),
  'a retry may reuse a FAILED job''s expected_output_key -- the partial index only covers active jobs');
select set_config('t.job_f_retry',
  (select id::text from public.transcode_jobs
     where expected_output_key = current_setting('t.key_f') and id <> current_setting('t.job_f')::uuid), false);

reset role;
set local role service_role;

-- The OLD failed job's stale completion event must be refused outright now -- it never
-- reaches the key comparison at all, because job_f is no longer active.
select throws_ok(
  format($$ select public.register_transcode_output(%L, %L, 100, 'hash_stale') $$,
         current_setting('t.job_f'), current_setting('t.key_f')),
  'P0001', 'Job is not active', 'a failed job''s stale completion event is refused, not re-registered');
select is(
  (select status::text from public.transcode_jobs where id = current_setting('t.job_f')::uuid),
  'failed', 'the old failed job is untouched by its own refused stale event');

-- The retry job's genuine completion registers normally.
select lives_ok(
  format($$ select public.register_transcode_output(%L, %L, 200, 'hash_retry') $$,
         current_setting('t.job_f_retry'), current_setting('t.key_f')),
  'the retry job''s genuine completion registers successfully');
select is(
  (select count(*) from public.assets
     where title_id = current_setting('t.title_m')::uuid and kind = 'screener'
       and storage_key = current_setting('t.key_f'))::int,
  1, 'exactly one screener asset exists at the retried key');

-- ============================================================================
-- E. RLS -- own-org read for every view-capable role, GC sees across orgs, cross-tenant
--    isolation holds. (Also the regression guard for this migration's explicit
--    `grant select ... to authenticated` -- see the file header.)
-- ============================================================================

-- Fix round 1 (finding 4's own test gap): anon must be unable to read this table at all --
-- not "RLS returns zero rows" but a flat permission denial at the grant level, since anon
-- now has NO grant whatsoever (`revoke all ... from anon` in the migration). This is
-- exactly the check that would have caught the missing revoke: it is invisible on a
-- from-scratch rebuild without it (anon still gets nothing there either, via whatever the
-- ambient default happens to be) and only diverges on a production database that already
-- carries the wider legacy default -- so this assertion is the one that actually pins the
-- fix rather than merely being consistent with it.
reset role;
set local role anon;
select throws_ok(
  $$ select 1 from public.transcode_jobs limit 1 $$,
  '42501', null, 'anon cannot SELECT transcode_jobs at all (no table grant)');

reset role;
set local role authenticated;

-- Five jobs exist for org A at this point: job_m, job_d, job_f, job_n, job_f_retry.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select is(
  (select count(*) from public.transcode_jobs where org_id = current_setting('t.org')::uuid)::int,
  5, 'account_owner sees all five of their org''s transcode jobs');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewer'), 'role','authenticated')::text, true);
select is(
  (select count(*) from public.transcode_jobs where org_id = current_setting('t.org')::uuid)::int,
  5, 'a bare viewer (view-capable, not operate-capable) can still read the org''s jobs');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);
select is(
  (select count(*) from public.transcode_jobs where org_id = current_setting('t.org')::uuid)::int,
  5, 'GC (gc_can view) sees org A''s jobs too');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner_b'), 'role','authenticated')::text, true);
select is(
  (select count(*) from public.transcode_jobs where org_id = current_setting('t.org')::uuid)::int,
  0, 'a member of a completely different org sees none of org A''s transcode jobs');

reset role;
select * from finish();
rollback;
