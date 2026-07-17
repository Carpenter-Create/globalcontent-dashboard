-- contract_rls_test.sql
-- Tenant isolation on the contract layer + assent immutability.
-- One org's user must never read another org's terms/assents/subscriptions, and the
-- assent record is append-only (revoked UPDATE/DELETE).

begin;
select plan(8);

-- Fixtures (owner role — RLS bypassed for setup).
select set_config('t.org_a',  gen_random_uuid()::text, false);
select set_config('t.org_b',  gen_random_uuid()::text, false);
select set_config('t.user_a', gen_random_uuid()::text, false);
select set_config('t.user_b', gen_random_uuid()::text, false);
select set_config('t.doc_a',  gen_random_uuid()::text, false);
select set_config('t.doc_b',  gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.user_a')::uuid), (current_setting('t.user_b')::uuid);
insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'), (current_setting('t.org_b')::uuid, 'Org B');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.user_a')::uuid, 'account_owner', 'active'),
  (current_setting('t.org_b')::uuid, current_setting('t.user_b')::uuid, 'account_owner', 'active');

insert into public.source_documents (id, org_id, kind, content_hash) values
  (current_setting('t.doc_a')::uuid, current_setting('t.org_a')::uuid, 'agreement', 'ha'),
  (current_setting('t.doc_b')::uuid, current_setting('t.org_b')::uuid, 'agreement', 'hb');
insert into public.contract_assents (org_id, user_id, terms_version, content_hash, source_document_id) values
  (current_setting('t.org_a')::uuid, current_setting('t.user_a')::uuid, 'v1', 'ha', current_setting('t.doc_a')::uuid),
  (current_setting('t.org_b')::uuid, current_setting('t.user_b')::uuid, 'v1', 'hb', current_setting('t.doc_b')::uuid);
insert into public.contract_terms (org_id, tier, revenue_share_rate_bp, effective_from, term_length_months, expires_at, trigger, source_document_id) values
  (current_setting('t.org_a')::uuid, 'pro', 0, now(), 12, now() + interval '12 months', 'signup', current_setting('t.doc_a')::uuid),
  (current_setting('t.org_b')::uuid, 'pro', 0, now(), 12, now() + interval '12 months', 'signup', current_setting('t.doc_b')::uuid);
insert into public.subscriptions (org_id, tier, status, annual_price_cents, stripe_subscription_id) values
  (current_setting('t.org_a')::uuid, 'pro', 'active', 49700, 'sub_a'),
  (current_setting('t.org_b')::uuid, 'pro', 'active', 49700, 'sub_b');

-- ===== Become user_a (org A) =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.user_a'), 'role', 'authenticated')::text, true);

select isnt_empty($$ select 1 from public.contract_terms where org_id = current_setting('t.org_a')::uuid $$,
  'user_a sees own contract_terms');
select is((select count(*) from public.contract_terms where org_id = current_setting('t.org_b')::uuid)::int,
  0, 'user_a CANNOT see org B contract_terms');
select isnt_empty($$ select 1 from public.contract_assents where org_id = current_setting('t.org_a')::uuid $$,
  'user_a sees own contract_assents');
select is((select count(*) from public.contract_assents where org_id = current_setting('t.org_b')::uuid)::int,
  0, 'user_a CANNOT see org B contract_assents');
select isnt_empty($$ select 1 from public.subscriptions where org_id = current_setting('t.org_a')::uuid $$,
  'user_a sees own subscription');
select is((select count(*) from public.subscriptions where org_id = current_setting('t.org_b')::uuid)::int,
  0, 'user_a CANNOT see org B subscription');

-- Assent is append-only (revoked UPDATE/DELETE) — role-level, so 42501 for authenticated.
select throws_ok($$ update public.contract_assents set content_hash = 'tamper' $$,
  '42501', null, 'contract_assents UPDATE blocked (immutable)');
select throws_ok($$ delete from public.contract_assents $$,
  '42501', null, 'contract_assents DELETE blocked (immutable)');

reset role;
select * from finish();
rollback;
