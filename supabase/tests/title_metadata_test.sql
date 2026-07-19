-- title_metadata_test.sql
-- Metadata: tenant isolation, set_title_metadata capability matrix, cross-org
-- rejection, and upsert (second call updates, one row).

begin;
select plan(9);

select set_config('t.org_a',  gen_random_uuid()::text, false);
select set_config('t.org_b',  gen_random_uuid()::text, false);
select set_config('t.owner',  gen_random_uuid()::text, false);  -- account_owner, A
select set_config('t.deliv',  gen_random_uuid()::text, false);  -- delivery_ops,  A
select set_config('t.viewer', gen_random_uuid()::text, false);  -- viewer,        A
select set_config('t.gc',     gen_random_uuid()::text, false);  -- GC staff
select set_config('t.title_a',gen_random_uuid()::text, false);
select set_config('t.title_b',gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.owner')::uuid), (current_setting('t.deliv')::uuid),
  (current_setting('t.viewer')::uuid), (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'), (current_setting('t.org_b')::uuid, 'Org B');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner')::uuid,  'account_owner', 'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.deliv')::uuid,  'delivery_ops',  'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.viewer')::uuid, 'viewer',        'active');
insert into public.gc_staff (user_id, role) values
  (current_setting('t.gc')::uuid, 'gc_delivery_ops');
insert into public.titles (id, org_id, title) values
  (current_setting('t.title_a')::uuid, current_setting('t.org_a')::uuid, 'Title A'),
  (current_setting('t.title_b')::uuid, current_setting('t.org_b')::uuid, 'Title B');

-- Fixture metadata (owner-role setup).
insert into public.title_metadata (title_id, org_id, data)
values (current_setting('t.title_a')::uuid, current_setting('t.org_a')::uuid, '{"synopsis":"x"}'::jsonb);

-- ===== authenticated =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);

select isnt_empty($$ select 1 from public.title_metadata where org_id = current_setting('t.org_a')::uuid $$,
  'owner_a sees own org metadata');
select is((select count(*) from public.title_metadata where org_id = current_setting('t.org_b')::uuid)::int,
  0, 'owner_a CANNOT see org B metadata (tenant isolation)');

select throws_ok($$ update public.title_metadata set data = '{}'::jsonb $$,
  '42501', null, 'direct client UPDATE is RLS-denied (RPC-only write path)');

select lives_ok($$ select public.set_title_metadata(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid, '{"synopsis":"updated","runtime_minutes":90}'::jsonb) $$,
  'account_owner: set_title_metadata succeeds');
select is((select count(*) from public.title_metadata where title_id = current_setting('t.title_a')::uuid)::int,
  1, 'upsert keeps a single row per title');
select is((select data->>'synopsis' from public.title_metadata where title_id = current_setting('t.title_a')::uuid),
  'updated', 'upsert updated the data');

-- cross-org: title B not in org A → raises
select throws_ok($$ select public.set_title_metadata(
  current_setting('t.org_a')::uuid, current_setting('t.title_b')::uuid, '{}'::jsonb) $$,
  'P0001', null, 'set_title_metadata rejects a title from another org');

-- viewer cannot
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewer'), 'role', 'authenticated')::text, true);
select throws_ok($$ select public.set_title_metadata(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid, '{}'::jsonb) $$,
  'P0001', null, 'viewer: set_title_metadata raises (not operate-capable)');

-- GC staff (all orgs)
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select lives_ok($$ select public.set_title_metadata(
  current_setting('t.org_b')::uuid, current_setting('t.title_b')::uuid, '{"synopsis":"b"}'::jsonb) $$,
  'gc_staff: set_title_metadata succeeds on any org');

reset role;
select * from finish();
rollback;
