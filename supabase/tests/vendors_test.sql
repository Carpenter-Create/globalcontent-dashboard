-- vendors_test.sql
-- vendors: GC-only read+write, client denial, email-mode CHECK, name uniqueness.

begin;
select plan(9);

select set_config('t.org_a', gen_random_uuid()::text, false);
select set_config('t.owner', gen_random_uuid()::text, false);  -- client account_owner
select set_config('t.gc',    gen_random_uuid()::text, false);  -- GC staff

insert into auth.users (id) values
  (current_setting('t.owner')::uuid), (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values (current_setting('t.org_a')::uuid, 'Org A');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner')::uuid, 'account_owner', 'active');
insert into public.gc_staff (user_id, role) values
  (current_setting('t.gc')::uuid, 'gc_delivery_ops');

set local role authenticated;

-- ===== GC staff: full CRUD (except delete) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select lives_ok($$ insert into public.vendors (name, delivery_mode) values ('Vendor One', 'portal_upload') $$,
  'gc_staff: insert vendor (portal_upload) succeeds');
select lives_ok($$ insert into public.vendors (name, delivery_mode, email_to) values ('Vendor Two', 'email', array['ops@vendor.test']) $$,
  'gc_staff: insert vendor (email + recipient) succeeds');
select isnt_empty($$ select 1 from public.vendors where name = 'Vendor One' $$,
  'gc_staff: reads vendors');
select lives_ok($$ update public.vendors set active = false where name = 'Vendor One' $$,
  'gc_staff: update (deactivate) succeeds');

-- email mode requires a recipient (CHECK)
select throws_ok($$ insert into public.vendors (name, delivery_mode) values ('No Email', 'email') $$,
  '23514', null, 'email mode without email_to violates CHECK');

-- case-insensitive name uniqueness
select throws_ok($$ insert into public.vendors (name, delivery_mode) values ('vendor one', 'portal_upload') $$,
  '23505', null, 'duplicate name (case-insensitive) rejected');

-- ===== client account_owner: no read, no write =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select is((select count(*) from public.vendors)::int, 0, 'client: cannot read vendors (RLS)');
select throws_ok($$ insert into public.vendors (name, delivery_mode) values ('Sneaky', 'portal_upload') $$,
  '42501', null, 'client: insert denied (RLS)');
-- A client UPDATE matches no rows under RLS (USING is false) → affects 0 rows
-- silently rather than raising. Run it as the client (no error, a no-op), then
-- switch back to gc_staff and assert the row is unchanged — the honest proof the
-- RLS policy filtered it out. (A data-modifying CTE can't be nested inside is().)
update public.vendors set active = false where name = 'Vendor Two';
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select is(
  (select active from public.vendors where name = 'Vendor Two'),
  true, 'client: update was a no-op — row unchanged (RLS filtered it)');

reset role;
select * from finish();
rollback;
