-- create_org_and_membership_test.sql
-- The mutation-as-RPC write path: creates org (status 'registered') + owner membership
-- atomically, authorizes on auth.uid(), and rejects unauthenticated / empty input.

begin;
select plan(6);

select set_config('t.user_x', gen_random_uuid()::text, false);
insert into auth.users (id) values (current_setting('t.user_x')::uuid);

-- ===== Become user_x =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.user_x'), 'role', 'authenticated')::text, true);

-- Happy path: call the RPC, capture the new org id.
select set_config('t.new_org',
  (select public.create_org_and_membership('Acme Films'))::text, true);

select is(
  (select status from public.organizations where id = current_setting('t.new_org')::uuid)::text,
  'registered', 'new org created with status = registered');
select is(
  (select role from public.memberships
     where org_id = current_setting('t.new_org')::uuid
       and user_id = current_setting('t.user_x')::uuid)::text,
  'account_owner', 'creator is account_owner');
select is(
  (select status from public.memberships
     where org_id = current_setting('t.new_org')::uuid
       and user_id = current_setting('t.user_x')::uuid)::text,
  'active', 'owner membership is active');
select isnt_empty(
  $$ select 1 from public.organizations where id = current_setting('t.new_org')::uuid $$,
  'creator can now read the org via RLS (write + read path proven)');

-- Unauthenticated: no sub claim → auth.uid() null → rejected.
select set_config('request.jwt.claims',
  json_build_object('role', 'authenticated')::text, true);
select throws_ok(
  $$ select public.create_org_and_membership('Nope Inc') $$,
  'P0001', 'Not authenticated', 'RPC rejects unauthenticated caller');

-- Empty name: rejected (re-authenticate first).
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.user_x'), 'role', 'authenticated')::text, true);
select throws_ok(
  $$ select public.create_org_and_membership('   ') $$,
  'P0001', 'Organization name is required', 'RPC rejects blank org name');

reset role;
select * from finish();
rollback;
