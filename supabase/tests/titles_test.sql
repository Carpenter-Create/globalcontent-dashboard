-- titles_test.sql
-- The title stub: tenant isolation, the create_title capability matrix, the RPC-only
-- write path (no direct client INSERT), the 'draft' default, and audit provenance.

begin;
select plan(11);

-- Fixtures (owner role — RLS bypassed for setup).
select set_config('t.org_a',  gen_random_uuid()::text, false);
select set_config('t.org_b',  gen_random_uuid()::text, false);
select set_config('t.owner',  gen_random_uuid()::text, false);  -- account_owner, org A
select set_config('t.deliv',  gen_random_uuid()::text, false);  -- delivery_ops,  org A
select set_config('t.viewer', gen_random_uuid()::text, false);  -- viewer,        org A
select set_config('t.acct',   gen_random_uuid()::text, false);  -- accountant,    org A
select set_config('t.legal',  gen_random_uuid()::text, false);  -- legal,         org A
select set_config('t.gc',     gen_random_uuid()::text, false);  -- GC staff (all orgs)

insert into auth.users (id) values
  (current_setting('t.owner')::uuid), (current_setting('t.deliv')::uuid),
  (current_setting('t.viewer')::uuid), (current_setting('t.acct')::uuid),
  (current_setting('t.legal')::uuid), (current_setting('t.gc')::uuid);

insert into public.organizations (id, name, status) values
  (current_setting('t.org_a')::uuid, 'Org A', 'active'), (current_setting('t.org_b')::uuid, 'Org B', 'active');

insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner')::uuid,  'account_owner', 'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.deliv')::uuid,  'delivery_ops',  'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.viewer')::uuid, 'viewer',        'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.acct')::uuid,   'accountant',    'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.legal')::uuid,  'legal',         'active');

insert into public.gc_staff (user_id, role) values
  (current_setting('t.gc')::uuid, 'gc_delivery_ops');

-- Direct fixture titles (owner-role setup) — one per org.
insert into public.titles (org_id, title) values
  (current_setting('t.org_a')::uuid, 'Fixture A'),
  (current_setting('t.org_b')::uuid, 'Fixture B');

-- New title defaults to 'draft' (§11 lifecycle start).
select is((select status from public.titles where title = 'Fixture A')::text,
  'draft', 'new title defaults to draft');

-- audit_log captured the insert (provenance for a manual stub — golden rule 5).
select isnt_empty($$
  select 1 from public.audit_log
   where entity = 'titles' and action = 'insert'
     and org_id = current_setting('t.org_a')::uuid $$,
  'create writes an audit_log insert row');

-- ===== Become owner_a (org A) =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);

select isnt_empty($$ select 1 from public.titles where org_id = current_setting('t.org_a')::uuid $$,
  'owner_a sees own org titles');
select is((select count(*) from public.titles where org_id = current_setting('t.org_b')::uuid)::int,
  0, 'owner_a CANNOT see org B titles (tenant isolation)');

-- No client INSERT policy — direct writes are RLS-denied; only the RPC writes.
select throws_ok($$ insert into public.titles (org_id, title)
    values (current_setting('t.org_a')::uuid, 'Direct') $$,
  '42501', null, 'direct client INSERT is rejected (RPC-only write path)');

-- create_title capability matrix (RPC re-checks member_can 'operate').
select lives_ok($$ select public.create_title(current_setting('t.org_a')::uuid, 'Owner Title', 'new_release'::public.release_type, null) $$,
  'account_owner: create_title succeeds');

-- ===== delivery_ops =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.deliv'), 'role', 'authenticated')::text, true);
select lives_ok($$ select public.create_title(current_setting('t.org_a')::uuid, 'Deliv Title', 'new_release'::public.release_type, null) $$,
  'delivery_ops: create_title succeeds');

-- ===== viewer =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewer'), 'role', 'authenticated')::text, true);
select throws_ok($$ select public.create_title(current_setting('t.org_a')::uuid, 'Nope', 'new_release'::public.release_type, null) $$,
  'P0001', null, 'viewer: create_title raises (not operate-capable)');

-- ===== accountant =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.acct'), 'role', 'authenticated')::text, true);
select throws_ok($$ select public.create_title(current_setting('t.org_a')::uuid, 'Nope', 'new_release'::public.release_type, null) $$,
  'P0001', null, 'accountant: create_title raises (not operate-capable)');

-- ===== legal =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.legal'), 'role', 'authenticated')::text, true);
select throws_ok($$ select public.create_title(current_setting('t.org_a')::uuid, 'Nope', 'new_release'::public.release_type, null) $$,
  'P0001', null, 'legal: create_title raises (read-only)');

-- ===== GC staff (scope inverts — all orgs) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select lives_ok($$ select public.create_title(current_setting('t.org_b')::uuid, 'GC Title', 'new_release'::public.release_type, null) $$,
  'gc_staff: create_title succeeds on any org');

reset role;
select * from finish();
rollback;
