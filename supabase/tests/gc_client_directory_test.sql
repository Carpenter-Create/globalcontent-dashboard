-- gc_client_directory_test.sql
-- gc_client_directory(): GC-only gate, email↔role pairing, active-seat scoping, bound,
-- current-contract-tier selection, and Stripe billing status passthrough.

begin;
select plan(13);

select set_config('t.orgA',     gen_random_uuid()::text, false);
select set_config('t.orgB',     gen_random_uuid()::text, false);
select set_config('t.orgC',     gen_random_uuid()::text, false);
select set_config('t.ownerA',   gen_random_uuid()::text, false);
select set_config('t.viewerA',  gen_random_uuid()::text, false);
select set_config('t.removedA', gen_random_uuid()::text, false);
select set_config('t.ownerB',   gen_random_uuid()::text, false);
select set_config('t.ownerC',   gen_random_uuid()::text, false);
select set_config('t.gc',       gen_random_uuid()::text, false);

insert into auth.users (id, email) values
  (current_setting('t.ownerA')::uuid,   'ownerA@test.example'),
  (current_setting('t.viewerA')::uuid,  'viewerA@test.example'),
  (current_setting('t.removedA')::uuid, 'removedA@test.example'),
  (current_setting('t.ownerB')::uuid,   'ownerB@test.example'),
  (current_setting('t.ownerC')::uuid,   'ownerC@test.example'),
  (current_setting('t.gc')::uuid,       'gc@test.example');
-- 'Zzz' sorts after 'Aaa' so the org ordering is actually exercised, not coincidental.
insert into public.organizations (id, name, status) values
  (current_setting('t.orgA')::uuid, 'Aaa Films',   'active'),
  (current_setting('t.orgB')::uuid, 'Zzz Pictures','payment_lapsed'),
  (current_setting('t.orgC')::uuid, 'Mmm Media',   'registered');
insert into public.memberships (user_id, org_id, role, status) values
  (current_setting('t.ownerA')::uuid,   current_setting('t.orgA')::uuid, 'account_owner', 'active'),
  (current_setting('t.viewerA')::uuid,  current_setting('t.orgA')::uuid, 'viewer',        'active'),
  (current_setting('t.removedA')::uuid, current_setting('t.orgA')::uuid, 'viewer',        'removed'),
  (current_setting('t.ownerB')::uuid,   current_setting('t.orgB')::uuid, 'account_owner', 'active'),
  (current_setting('t.ownerC')::uuid,   current_setting('t.orgC')::uuid, 'account_owner', 'active');
insert into public.gc_staff (user_id, role) values
  (current_setting('t.gc')::uuid, 'gc_delivery_ops');

-- Org A has been through a lapse: the older 'pro' term is still on file (terms are immutable)
-- and an 'access' term was appended. effective_to is null on BOTH, which is exactly why the
-- function selects on effective_from instead.
insert into public.contract_terms
  (org_id, tier, revenue_share_rate_bp, effective_from, term_length_months, expires_at, trigger)
values
  (current_setting('t.orgA')::uuid, 'pro',    8000, now() - interval '60 days', 12,
   now() + interval '305 days', 'signup'),
  (current_setting('t.orgA')::uuid, 'access', 8000, now() - interval '1 day',   12,
   now() + interval '364 days', 'lapse'),
  (current_setting('t.orgB')::uuid, 'premium',8500, now() - interval '10 days', 36,
   now() + interval '1085 days','signup');
-- Org B's card is failing; the contract still says premium. Org A (Access) has no Stripe
-- subscription at all, and org C has neither a term nor a subscription.
insert into public.subscriptions (org_id, tier, status, annual_price_cents) values
  (current_setting('t.orgB')::uuid, 'premium', 'past_due', 199700);

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

-- ---- current contract tier, not the superseded one -------------------------
select is(
  (select tier::text from public.gc_client_directory() where email = 'ownerA@test.example'),
  'access',
  'the lapsed org reports its CURRENT access term, not the older pro term');

select is(
  (select tier::text from public.gc_client_directory() where email = 'ownerB@test.example'),
  'premium',
  'a single-term org reports that term');

-- ---- billing status is a separate fact from the tier ------------------------
select is(
  (select subscription_status from public.gc_client_directory() where email = 'ownerB@test.example'),
  'past_due',
  'a failing card surfaces while the contract still says premium');

select ok(
  (select tier is null and subscription_status is null
   from public.gc_client_directory() where email = 'ownerC@test.example'),
  'an org with no contract and no subscription reports null for both, never a defaulted tier');

select * from finish();
rollback;
