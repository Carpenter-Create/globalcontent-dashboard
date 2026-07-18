-- contract_flow_test.sql
-- The clickwrap accept path + Stripe finalize (domain-spec §3/§5/§21.18):
--   free tier → assent + rendered-terms source doc + contract_terms + active
--   paid tier → assent + source doc + awaiting_payment (NO term yet)
--   authorization: account-owner only; unauthenticated rejected
--   finalize_paid_signup: writes subscription + term + active, idempotent on replay

begin;
select plan(15);

-- Fixtures (owner role — RLS bypassed; the RPCs are SECURITY DEFINER).
select set_config('t.org_a',    gen_random_uuid()::text, false);
select set_config('t.org_b',    gen_random_uuid()::text, false);
select set_config('t.owner_a',  gen_random_uuid()::text, false);
select set_config('t.owner_b',  gen_random_uuid()::text, false);
select set_config('t.viewer_a', gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.owner_a')::uuid),
  (current_setting('t.owner_b')::uuid),
  (current_setting('t.viewer_a')::uuid);
insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'),
  (current_setting('t.org_b')::uuid, 'Org B');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner_a')::uuid,  'account_owner', 'active'),
  (current_setting('t.org_b')::uuid, current_setting('t.owner_b')::uuid,  'account_owner', 'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.viewer_a')::uuid, 'viewer',        'active');

-- ===== FREE (Access): owner_a accepts =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner_a'), 'role', 'authenticated')::text, true);
select set_config('t.res_a',
  (select public.accept_terms('access','v1','hash-a','ACCESS TERMS TEXT','1.2.3.4'::inet,'UA-a'))::text, true);
reset role;

select is((current_setting('t.res_a')::jsonb->>'needs_payment'), 'false', 'free: needs_payment=false');
select is((select status from public.organizations where id = current_setting('t.org_a')::uuid)::text,
  'active', 'free: org → active');
select isnt_empty($$ select 1 from public.contract_terms
  where org_id = current_setting('t.org_a')::uuid and tier = 'access' $$, 'free: access term written');
select isnt_empty($$ select 1 from public.contract_assents
  where org_id = current_setting('t.org_a')::uuid and content_hash = 'hash-a' $$, 'free: assent recorded');
select isnt_empty($$ select 1 from public.source_documents
  where org_id = current_setting('t.org_a')::uuid and kind = 'agreement' $$, 'free: rendered terms as source doc');

-- ===== PAID (Pro): owner_b accepts — awaits payment, NO term yet =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner_b'), 'role', 'authenticated')::text, true);
select set_config('t.res_b',
  (select public.accept_terms('pro','v1','hash-b','PRO TERMS TEXT',null,null))::text, true);
reset role;

select is((current_setting('t.res_b')::jsonb->>'needs_payment'), 'true', 'paid: needs_payment=true');
select is((select status from public.organizations where id = current_setting('t.org_b')::uuid)::text,
  'awaiting_payment', 'paid: org → awaiting_payment');
select is((select count(*) from public.contract_terms where org_id = current_setting('t.org_b')::uuid)::int,
  0, 'paid: NO contract_terms until payment');
select isnt_empty($$ select 1 from public.contract_assents
  where org_id = current_setting('t.org_b')::uuid $$, 'paid: assent recorded at accept');

-- ===== Authorization =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewer_a'), 'role', 'authenticated')::text, true);
select throws_ok(
  $$ select public.accept_terms('access','v1','h','T',null,null) $$,
  'P0001', 'Only the account owner can accept the agreement', 'non-owner cannot accept');
select set_config('request.jwt.claims', json_build_object('role','authenticated')::text, true);
select throws_ok(
  $$ select public.accept_terms('access','v1','h','T',null,null) $$,
  'P0001', 'Not authenticated', 'unauthenticated cannot accept');
reset role;

-- ===== finalize_paid_signup (webhook path) on org_b, idempotent =====
select set_config('t.doc_b', (current_setting('t.res_b')::jsonb->>'source_document_id'), true);
select public.finalize_paid_signup(
  current_setting('t.org_b')::uuid, 'pro', 'cus_test', 'sub_test', 49700, now(),
  current_setting('t.doc_b')::uuid);

select is((select status from public.organizations where id = current_setting('t.org_b')::uuid)::text,
  'active', 'finalize: org → active');
select isnt_empty($$ select 1 from public.subscriptions
  where org_id = current_setting('t.org_b')::uuid and stripe_subscription_id = 'sub_test' $$,
  'finalize: subscription row written');
select is((select count(*) from public.contract_terms where org_id = current_setting('t.org_b')::uuid)::int,
  1, 'finalize: pro term written');

-- replay the webhook — must not double-write
select public.finalize_paid_signup(
  current_setting('t.org_b')::uuid, 'pro', 'cus_test', 'sub_test', 49700, now(),
  current_setting('t.doc_b')::uuid);
select is((select count(*) from public.contract_terms where org_id = current_setting('t.org_b')::uuid)::int,
  1, 'finalize idempotent: still one term after replay');

select * from finish();
rollback;
