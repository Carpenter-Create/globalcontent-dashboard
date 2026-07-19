-- assets_test.sql
-- Assets: tenant isolation, create_asset capability matrix, immutability,
-- and cross-org title rejection.

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

-- Fixture asset (owner-role setup).
insert into public.assets (org_id, title_id, kind, storage_key, content_hash, bytes)
values (current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
        'master', 'orgs/a/titles/a/master/x/file.mxf', 'sha256:abc', 123);

-- ===== authenticated =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);

select isnt_empty($$ select 1 from public.assets where org_id = current_setting('t.org_a')::uuid $$,
  'owner_a sees own org assets');
select is((select count(*) from public.assets where org_id = current_setting('t.org_b')::uuid)::int,
  0, 'owner_a CANNOT see org B assets (tenant isolation)');

select throws_ok($$ update public.assets set content_hash = 'tamper' $$,
  '42501', null, 'assets UPDATE blocked (immutable)');
select throws_ok($$ delete from public.assets $$,
  '42501', null, 'assets DELETE blocked (immutable)');

select lives_ok($$ select public.create_asset(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  'caption', 'orgs/a/titles/a/caption/y/subs.vtt', 'sha256:def', 10, 'text/vtt', 'subs.vtt') $$,
  'account_owner: create_asset succeeds');

-- cross-org: title B does not belong to org A → raises
select throws_ok($$ select public.create_asset(
  current_setting('t.org_a')::uuid, current_setting('t.title_b')::uuid,
  'master', 'k', 'h', 1, null, null) $$,
  'P0001', null, 'create_asset rejects a title from another org');

-- delivery_ops can
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.deliv'), 'role', 'authenticated')::text, true);
select lives_ok($$ select public.create_asset(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  'artwork', 'orgs/a/titles/a/artwork/z/key.jpg', 'sha256:ghi', 5, 'image/jpeg', 'key.jpg') $$,
  'delivery_ops: create_asset succeeds');

-- viewer cannot
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewer'), 'role', 'authenticated')::text, true);
select throws_ok($$ select public.create_asset(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  'master', 'k', 'h', 1, null, null) $$,
  'P0001', null, 'viewer: create_asset raises (not operate-capable)');

-- GC staff (all orgs)
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select lives_ok($$ select public.create_asset(
  current_setting('t.org_b')::uuid, current_setting('t.title_b')::uuid,
  'master', 'orgs/b/titles/b/master/w/f.mxf', 'sha256:jkl', 9, null, null) $$,
  'gc_staff: create_asset succeeds on any org');

reset role;
select * from finish();
rollback;
