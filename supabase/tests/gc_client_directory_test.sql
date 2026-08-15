-- gc_client_directory_test.sql
-- gc_client_directory(): GC-only gate, email↔role pairing, active-seat scoping, bound.

begin;
select plan(9);

select set_config('t.orgA',     gen_random_uuid()::text, false);
select set_config('t.orgB',     gen_random_uuid()::text, false);
select set_config('t.ownerA',   gen_random_uuid()::text, false);
select set_config('t.viewerA',  gen_random_uuid()::text, false);
select set_config('t.removedA', gen_random_uuid()::text, false);
select set_config('t.ownerB',   gen_random_uuid()::text, false);
select set_config('t.gc',       gen_random_uuid()::text, false);

insert into auth.users (id, email) values
  (current_setting('t.ownerA')::uuid,   'ownerA@test.example'),
  (current_setting('t.viewerA')::uuid,  'viewerA@test.example'),
  (current_setting('t.removedA')::uuid, 'removedA@test.example'),
  (current_setting('t.ownerB')::uuid,   'ownerB@test.example'),
  (current_setting('t.gc')::uuid,       'gc@test.example');
-- 'Zzz' sorts after 'Aaa' so the org ordering is actually exercised, not coincidental.
insert into public.organizations (id, name, status) values
  (current_setting('t.orgA')::uuid, 'Aaa Films',   'active'),
  (current_setting('t.orgB')::uuid, 'Zzz Pictures','payment_lapsed');
insert into public.memberships (user_id, org_id, role, status) values
  (current_setting('t.ownerA')::uuid,   current_setting('t.orgA')::uuid, 'account_owner', 'active'),
  (current_setting('t.viewerA')::uuid,  current_setting('t.orgA')::uuid, 'viewer',        'active'),
  (current_setting('t.removedA')::uuid, current_setting('t.orgA')::uuid, 'viewer',        'removed'),
  (current_setting('t.ownerB')::uuid,   current_setting('t.orgB')::uuid, 'account_owner', 'active');
insert into public.gc_staff (user_id, role) values
  (current_setting('t.gc')::uuid, 'gc_delivery_ops');

-- ---- gate: a client cannot read the directory ------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.ownerA'), 'role', 'authenticated')::text, true);
select throws_ok(
  $$ select * from public.gc_client_directory() $$,
  'P0001', 'Not authorized', 'an org account_owner cannot read the client directory');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewerA'), 'role', 'authenticated')::text, true);
select throws_ok(
  $$ select * from public.gc_client_directory() $$,
  'P0001', 'Not authorized', 'an org viewer cannot read the client directory');

-- ---- gate: anon cannot even execute ----------------------------------------
set local role anon;
select set_config('request.jwt.claims', null, true);
select throws_ok(
  $$ select * from public.gc_client_directory() $$,
  '42501', null, 'anon has no execute privilege on gc_client_directory');

-- ---- GC staff: sees every active seat across every org ---------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);

-- Scoped to this test's own orgs: the local database carries seeded orgs, so an absolute
-- count(*) here would assert the state of the dev box rather than the function.
select is(
  (select count(*)::int from public.gc_client_directory()
   where org_id in (current_setting('t.orgA')::uuid, current_setting('t.orgB')::uuid)),
  3,
  'GC sees the three active seats of these orgs and not the removed one');

select is(
  (select count(*)::int from public.gc_client_directory() where email = 'removedA@test.example'),
  0,
  'a removed membership is excluded');

-- ---- the point of the function: email is paired with ITS OWN role ----------
select is(
  (select role::text from public.gc_client_directory() where email = 'ownerA@test.example'),
  'account_owner',
  'the owner email carries the account_owner role');

select is(
  (select role::text from public.gc_client_directory() where email = 'viewerA@test.example'),
  'viewer',
  'the viewer email carries the viewer role — roles are not smeared across an org');

select is(
  (select organization from public.gc_client_directory() where email = 'ownerB@test.example'),
  'Zzz Pictures',
  'a non-active org is still listed, with its own name');

-- ---- the bound is real ------------------------------------------------------
select is(
  (select count(*)::int from public.gc_client_directory(1)),
  1,
  'p_limit bounds the result set');

select * from finish();
rollback;
