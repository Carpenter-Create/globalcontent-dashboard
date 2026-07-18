-- provenance_immutability_test.sql
-- audit_log is append-only and trigger-populated; the source layer is write-once (§18).
-- Also exercises the audit_log SELECT policy's GC-staff (all-org) branch.
-- The UPDATE/DELETE revokes are role-level, so they raise 42501 for `authenticated`.

begin;
select plan(10);

-- Fixtures (owner role — setup only).
select set_config('t.org_a', gen_random_uuid()::text, false);
select set_config('t.org_b', gen_random_uuid()::text, false);
select set_config('t.gc',    gen_random_uuid()::text, false);

insert into auth.users (id) values (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'),
  (current_setting('t.org_b')::uuid, 'Org B');
insert into public.gc_staff (user_id, role) values (current_setting('t.gc')::uuid, 'gc_account_owner');

-- source doc in A + a parsed record (exercises the source_records revoke too)
with d as (
  insert into public.source_documents (org_id, kind, content_hash)
  values (current_setting('t.org_a')::uuid, 'contract', 'hash-a') returning id
)
insert into public.source_records (document_id, org_id, line_no, parsed)
  select id, current_setting('t.org_a')::uuid, 1, '{"title":"x"}'::jsonb from d;

-- source doc in B (for GC all-org visibility)
insert into public.source_documents (org_id, kind, content_hash)
  values (current_setting('t.org_b')::uuid, 'contract', 'hash-b');

-- Trigger populated audit_log for the business inserts (asserted as owner).
select isnt_empty(
  $$ select 1 from public.audit_log where entity = 'organizations' and action = 'insert' $$,
  'audit trigger recorded organizations insert');
select isnt_empty(
  $$ select 1 from public.audit_log where entity = 'source_documents' and action = 'insert' $$,
  'audit trigger recorded source_documents insert');

-- ===== Become a GC staff user =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);

-- GC staff sees audit across ALL orgs (is_gc_staff branch of the SELECT policy)
select isnt_empty(
  $$ select 1 from public.audit_log where org_id = current_setting('t.org_a')::uuid $$,
  'GC staff sees org A audit_log');
select isnt_empty(
  $$ select 1 from public.audit_log where org_id = current_setting('t.org_b')::uuid $$,
  'GC staff sees org B audit_log (all orgs)');

-- Append-only: even GC-staff / authenticated cannot mutate the audit log (revoked).
select throws_ok($$ update public.audit_log set action = 'tamper' $$,
  '42501', null, 'audit_log UPDATE blocked (append-only)');
select throws_ok($$ delete from public.audit_log $$,
  '42501', null, 'audit_log DELETE blocked (append-only)');

-- Sources are write-once: UPDATE/DELETE blocked.
select throws_ok($$ update public.source_documents set kind = 'edited' $$,
  '42501', null, 'source_documents UPDATE blocked (immutable)');
select throws_ok($$ delete from public.source_documents $$,
  '42501', null, 'source_documents DELETE blocked (immutable)');
select throws_ok($$ update public.source_records set line_no = 99 $$,
  '42501', null, 'source_records UPDATE blocked (immutable)');
select throws_ok($$ delete from public.source_records $$,
  '42501', null, 'source_records DELETE blocked (immutable)');

reset role;
select * from finish();
rollback;
