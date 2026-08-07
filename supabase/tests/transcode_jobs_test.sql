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

begin;
select plan(44);

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
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_m'), 'orgs/a/titles/m/proxy/out_m.mp4'),
  'operate-capable owner creates a transcode job for their own org');
select set_config('t.job_m',
  (select id::text from public.transcode_jobs where expected_output_key = 'orgs/a/titles/m/proxy/out_m.mp4'), false);
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
         current_setting('t.org'), current_setting('t.title_d'), current_setting('t.asset_d'), 'orgs/a/titles/d/proxy/out_d.mp4'),
  'owner creates a job for the already-dedicated title');
select set_config('t.job_d',
  (select id::text from public.transcode_jobs where expected_output_key = 'orgs/a/titles/d/proxy/out_d.mp4'), false);

-- A9: a third job on title_m, left uncompleted, for the fail_transcode_job block below.
select lives_ok(
  format($$ select public.create_transcode_job(%L, %L, %L, %L) $$,
         current_setting('t.org'), current_setting('t.title_m'), current_setting('t.asset_m'), 'orgs/a/titles/m/proxy/out_f.mp4'),
  'owner creates a third job, left uncompleted for the fail_transcode_job block');
select set_config('t.job_f',
  (select id::text from public.transcode_jobs where expected_output_key = 'orgs/a/titles/m/proxy/out_f.mp4'), false);

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

-- B2: the claimed key does not equal job_m's own expected_output_key -- the authority
-- check. job_m is still 'submitted' at this point (only created, never registered).
select throws_ok(
  format($$ select public.register_transcode_output(%L, %L, %L, %L) $$,
         current_setting('t.job_m'), 'orgs/a/titles/m/proxy/WRONG.mp4', 1000, 'hash1'),
  'P0001', 'Output key does not match the job', 'a mismatched output key is refused');
select is(
  (select status::text from public.transcode_jobs where id = current_setting('t.job_m')::uuid),
  'submitted', 'job_m is untouched by the refused mismatched-key attempt');

-- B4: the correct key succeeds. title_m starts at screener_source default 'master' (never
-- set otherwise in this file), so this call also exercises the flip.
select lives_ok(
  format($$ select public.register_transcode_output(%L, %L, %L, %L) $$,
         current_setting('t.job_m'), 'orgs/a/titles/m/proxy/out_m.mp4', 1000, 'hash1'),
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
  'orgs/a/titles/m/proxy/out_m.mp4', 'the registered asset''s storage_key is the job''s expected_output_key');
select is(
  (select count(*) from public.assets where title_id = current_setting('t.title_m')::uuid and kind = 'screener')::int,
  1, 'exactly one screener asset exists for title_m');

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
     'orgs/a/titles/m/proxy/out_m.mp4', 999, 'hash2')::text),
  current_setting('t.output_asset_m'), 'a duplicate completion returns the same asset id');
select is(
  (select count(*) from public.assets where title_id = current_setting('t.title_m')::uuid and kind = 'screener')::int,
  1, 'a duplicate completion creates no second screener asset');
select is(
  (select bytes from public.assets where id = current_setting('t.output_asset_m')::uuid),
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
         current_setting('t.job_d'), 'orgs/a/titles/d/proxy/out_d.mp4', 500, 'hashD'),
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
-- E. RLS -- own-org read for every view-capable role, GC sees across orgs, cross-tenant
--    isolation holds. (Also the regression guard for this migration's explicit
--    `grant select ... to authenticated` -- see the file header.)
-- ============================================================================
reset role;
set local role authenticated;

-- Three jobs exist for org A at this point: job_m, job_d, job_f.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select is(
  (select count(*) from public.transcode_jobs where org_id = current_setting('t.org')::uuid)::int,
  3, 'account_owner sees all three of their org''s transcode jobs');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewer'), 'role','authenticated')::text, true);
select is(
  (select count(*) from public.transcode_jobs where org_id = current_setting('t.org')::uuid)::int,
  3, 'a bare viewer (view-capable, not operate-capable) can still read the org''s jobs');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);
select is(
  (select count(*) from public.transcode_jobs where org_id = current_setting('t.org')::uuid)::int,
  3, 'GC (gc_can view) sees org A''s jobs too');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner_b'), 'role','authenticated')::text, true);
select is(
  (select count(*) from public.transcode_jobs where org_id = current_setting('t.org')::uuid)::int,
  0, 'a member of a completely different org sees none of org A''s transcode jobs');

reset role;
select * from finish();
rollback;
