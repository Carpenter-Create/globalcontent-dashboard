-- rls_tenant_isolation_test.sql
-- TIER 1 (highest blast radius): one org's user must never read or write another org's rows.
-- Load-bearing step: STOP being the owner (which bypasses RLS) — become `authenticated`
-- and present JWT claims so auth.uid() resolves. Without this the test asserts nothing.

begin;
select plan(10);

-- Fixtures (owner role — RLS bypassed here, setup only).
select set_config('t.org_a',  gen_random_uuid()::text, false);
select set_config('t.org_b',  gen_random_uuid()::text, false);
select set_config('t.user_a', gen_random_uuid()::text, false);  -- owner of A
select set_config('t.view_a', gen_random_uuid()::text, false);  -- viewer of A
select set_config('t.user_b', gen_random_uuid()::text, false);  -- owner of B

insert into auth.users (id) values
  (current_setting('t.user_a')::uuid),
  (current_setting('t.view_a')::uuid),
  (current_setting('t.user_b')::uuid);

insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'),
  (current_setting('t.org_b')::uuid, 'Org B');

insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.user_a')::uuid, 'account_owner', 'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.view_a')::uuid, 'viewer',        'active'),
  (current_setting('t.org_b')::uuid, current_setting('t.user_b')::uuid, 'account_owner', 'active');

insert into public.source_documents (org_id, kind, content_hash) values
  (current_setting('t.org_a')::uuid, 'contract', 'hash-a'),
  (current_setting('t.org_b')::uuid, 'contract', 'hash-b');

-- ===== Become user_a (owner of A) =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.user_a'), 'role', 'authenticated')::text, true);

-- READ isolation
select isnt_empty(
  $$ select 1 from public.organizations where id = current_setting('t.org_a')::uuid $$,
  'user_a sees own org A');
select is(
  (select count(*) from public.organizations where id = current_setting('t.org_b')::uuid)::int,
  0, 'user_a CANNOT see org B');
select isnt_empty(
  $$ select 1 from public.source_documents where org_id = current_setting('t.org_a')::uuid $$,
  'user_a sees own source_documents');
select is(
  (select count(*) from public.source_documents where org_id = current_setting('t.org_b')::uuid)::int,
  0, 'user_a CANNOT see org B source_documents');
select is(
  (select count(*) from public.audit_log where org_id = current_setting('t.org_b')::uuid)::int,
  0, 'user_a CANNOT see org B audit_log');
select isnt_empty(
  $$ select 1 from public.audit_log where org_id = current_setting('t.org_a')::uuid $$,
  'user_a sees own audit_log (trigger populated it)');

-- WRITE: owner (operate) may insert a source into own org
select lives_ok(
  $$ insert into public.source_documents (org_id, kind, content_hash)
     values (current_setting('t.org_a')::uuid, 'note', 'hash-a2') $$,
  'user_a (owner→operate) can insert source into own org');

-- WRITE: cross-tenant insert into org B is blocked (WITH CHECK → member_can false)
select throws_ok(
  $$ insert into public.source_documents (org_id, kind, content_hash)
     values (current_setting('t.org_b')::uuid, 'note', 'evil') $$,
  '42501', null, 'user_a CANNOT insert source into org B (cross-tenant write blocked)');

-- ===== Become view_a (viewer of A): read yes, operate no =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.view_a'), 'role', 'authenticated')::text, true);

select isnt_empty(
  $$ select 1 from public.organizations where id = current_setting('t.org_a')::uuid $$,
  'viewer sees org A');
select throws_ok(
  $$ insert into public.source_documents (org_id, kind, content_hash)
     values (current_setting('t.org_a')::uuid, 'note', 'nope') $$,
  '42501', null, 'viewer CANNOT insert source (operate denied by WITH CHECK)');

reset role;
select * from finish();
rollback;
