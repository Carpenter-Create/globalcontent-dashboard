-- deliveries_test.sql
-- create_delivery: GC-only, rule-12 gates, hard exclusive-conflict block; set_delivery_status;
-- tenant isolation; my_deliveries scoping.

begin;
select plan(12);

select set_config('t.org_a', gen_random_uuid()::text, false);
select set_config('t.org_b', gen_random_uuid()::text, false);
select set_config('t.owner', gen_random_uuid()::text, false);  -- client account_owner, org A
select set_config('t.gc',    gen_random_uuid()::text, false);  -- GC staff
select set_config('t.ta',    gen_random_uuid()::text, false);  -- title A (org A)
select set_config('t.tb',    gen_random_uuid()::text, false);  -- title B (org B, same work)
select set_config('t.ga',    gen_random_uuid()::text, false);  -- grant on A
select set_config('t.vendor',gen_random_uuid()::text, false);
select set_config('t.work',  gen_random_uuid()::text, false);

insert into auth.users (id) values (current_setting('t.owner')::uuid), (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'), (current_setting('t.org_b')::uuid, 'Org B');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner')::uuid, 'account_owner', 'active');
insert into public.gc_staff (user_id, role) values (current_setting('t.gc')::uuid, 'gc_delivery_ops');
insert into public.works (id) values (current_setting('t.work')::uuid);
insert into public.titles (id, org_id, title, work_id) values
  (current_setting('t.ta')::uuid, current_setting('t.org_a')::uuid, 'Film', current_setting('t.work')::uuid),
  (current_setting('t.tb')::uuid, current_setting('t.org_b')::uuid, 'Film', current_setting('t.work')::uuid);
insert into public.vendors (id, name, delivery_mode) values
  (current_setting('t.vendor')::uuid, 'Endpoint One', 'portal_upload');
-- Grant on A: SVOD, include US, NON-exclusive, active.
insert into public.rights_grants (id, org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from) values
  (current_setting('t.ga')::uuid, current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid,
   'svod','include',array['US'], false, now());

set local role authenticated;

-- ===== client denied =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select public.create_delivery(%L,%L,%L,'US') $$, current_setting('t.ta'), current_setting('t.vendor'), current_setting('t.ga')),
  'P0001', 'Not authorized', 'client: create_delivery denied (not gc_staff)');

-- ===== GC: rule-12 gates =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
-- territory outside grant (grant is US; try CA)
select throws_ok(
  format($$ select public.create_delivery(%L,%L,%L,'CA') $$, current_setting('t.ta'), current_setting('t.vendor'), current_setting('t.ga')),
  'P0001', null, 'rule 12: territory outside grant refused');
-- valid create (US, covered)
select lives_ok(
  format($$ select public.create_delivery(%L,%L,%L,'US') $$, current_setting('t.ta'), current_setting('t.vendor'), current_setting('t.ga')),
  'gc: valid create_delivery (US covered) succeeds');
select is((select count(*) from public.deliveries where title_id = current_setting('t.ta')::uuid)::int,
  1, 'one delivery row created');
select is((select status::text from public.deliveries where title_id = current_setting('t.ta')::uuid),
  'pending', 'new delivery defaults to pending');

-- ===== hard conflict block =====
-- Org B (same work) declares EXCLUSIVE SVOD US → creating A's SVOD-US delivery must now be blocked
-- for a NEW territory pairing. Make A's grant also matter: add an exclusive grant path.
-- rights_grants has NO direct-INSERT policy (add_rights_grant() RPC is the sole write
-- path) — fixture inserts must run as superuser. Drop back out of the `authenticated`
-- role for the insert, then re-enter it; request.jwt.claims (set local = true) persists
-- across the role switch within this transaction, so the gc identity survives.
reset role;
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from) values
  (current_setting('t.org_b')::uuid, current_setting('t.tb')::uuid, 'svod','include',array['US'], true, now());
set local role authenticated;
-- A already has a non-exclusive SVOD-US grant (t.ga); B is exclusive SVOD-US on the same work →
-- a new delivery for A on SVOD-US must be blocked (exclusive involved on B's side).
select throws_ok(
  format($$ select public.create_delivery(%L,%L,%L,'US') $$, current_setting('t.ta'), current_setting('t.vendor'), current_setting('t.ga')),
  'P0001', null, 'hard block: another org exclusive same-work SVOD-US refuses the delivery');

-- non-exclusive coexistence: AVOD CA, both non-exclusive → allowed
reset role;
insert into public.rights_grants (id, org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from) values
  (gen_random_uuid(), current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid, 'avod','include',array['CA'], false, now());
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from) values
  (current_setting('t.org_b')::uuid, current_setting('t.tb')::uuid, 'avod','include',array['CA'], false, now());
set local role authenticated;
select set_config('t.ga_avod',
  (select id::text from public.rights_grants where title_id = current_setting('t.ta')::uuid and rights_type = 'avod' limit 1), false);
select lives_ok(
  format($$ select public.create_delivery(%L,%L,%L,'CA') $$, current_setting('t.ta'), current_setting('t.vendor'), current_setting('t.ga_avod')),
  'no block: two non-exclusive AVOD-CA claims coexist — delivery allowed');

-- ===== set_delivery_status =====
select set_config('t.dlv', (select id::text from public.deliveries where territory = 'US' and title_id = current_setting('t.ta')::uuid), false);
select lives_ok(
  format($$ select public.set_delivery_status(%L, 'live') $$, current_setting('t.dlv')),
  'gc: set_delivery_status to live succeeds');
select is((select status::text from public.deliveries where id = current_setting('t.dlv')::uuid),
  'live', 'status advanced to live');

-- ===== client: reads own deliveries; set_delivery_status denied; my_deliveries scoped =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select is((select count(*) from public.deliveries)::int, 2,
  'client: reads its own org deliveries via RLS (2 rows)');
select throws_ok(
  format($$ select public.set_delivery_status(%L, 'rejected') $$, current_setting('t.dlv')),
  'P0001', 'Not authorized', 'client: set_delivery_status denied');
select is((select count(*) from public.my_deliveries() where vendor_name = 'Endpoint One')::int, 2,
  'client: my_deliveries returns own deliveries + vendor name');

reset role;
select * from finish();
rollback;
