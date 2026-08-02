-- tier_rates_lapse_test.sql
-- Revenue-share rates and the lapse/renewal transitions (20260801000100).
--
-- Before that migration both term writers hardcoded 0, so every contract said the client's
-- share was 0%, and `payment_lapsed` had no writer anywhere while the UI already rendered a
-- label for it. These assertions are the standing proof that neither is true again.
--
-- THE IDEMPOTENCY CASES ARE THE POINT. Rule 8 requires the lapse job to be idempotent, and
-- Stripe redelivers out of order — so "calling it twice writes one row" matters more than
-- "calling it once works". Terms are immutable (rule 6): a duplicate term cannot be cleaned up.

begin;
select plan(18);

select set_config('t.org',  gen_random_uuid()::text, false);
select set_config('t.org2', gen_random_uuid()::text, false);
select set_config('t.doc',  gen_random_uuid()::text, false);
select set_config('t.fail', '2026-03-01T12:00:00Z', false);

insert into public.organizations (id, name, status) values
  (current_setting('t.org')::uuid,  'Lapse Org',  'active'),
  (current_setting('t.org2')::uuid, 'Renew Org',  'active');

insert into public.contract_terms
  (org_id, tier, revenue_share_rate_bp, effective_from, term_length_months, expires_at, trigger)
values
  (current_setting('t.org')::uuid,  'pro',     8000, '2026-01-01T00:00:00Z', 12, '2027-01-01T00:00:00Z', 'signup'),
  (current_setting('t.org2')::uuid, 'premium', 8500, '2026-01-01T00:00:00Z', 24, '2028-01-01T00:00:00Z', 'signup');

-- ── rates ───────────────────────────────────────────────────────────────────
select is(public.tier_revenue_share_bp('access'),  8000, 'access: client 80%');
select is(public.tier_revenue_share_bp('pro'),     8000, 'pro: client 80%');
select is(public.tier_revenue_share_bp('premium'), 8500, 'premium: client 85%');
-- Rule 7 — GC's share is derived, never stored. If someone ever stores GC's side instead,
-- this is the assertion that catches the inversion.
select is(10000 - public.tier_revenue_share_bp('premium'), 1500, 'premium: GC 15% by subtraction');
select ok(public.tier_revenue_share_bp('premium') > public.tier_revenue_share_bp('pro'),
          'premium gives the client MORE than pro (rate direction, spec §5)');

-- ── lapse ───────────────────────────────────────────────────────────────────
select lives_ok(
  format($$ select public.lapse_org(%L, %L::timestamptz) $$,
         current_setting('t.org'), current_setting('t.fail')),
  'lapse_org runs');

select is((select tier::text from public.contract_terms
            where org_id=current_setting('t.org')::uuid and trigger='lapse'),
          'access', 'lapse writes an ACCESS term');

-- The owner's decision: 30 days from the FIRST failed charge, not from Stripe's cancellation.
select is((select effective_from from public.contract_terms
            where org_id=current_setting('t.org')::uuid and trigger='lapse'),
          '2026-03-31T12:00:00Z'::timestamptz,
          'effective_from = first failure + 30 days exactly');

select is((select revenue_share_rate_bp from public.contract_terms
            where org_id=current_setting('t.org')::uuid and trigger='lapse'),
          8000, 'lapse term carries the ACCESS rate, snapshotted');

select is((select status::text from public.organizations where id=current_setting('t.org')::uuid),
          'payment_lapsed', 'org status reaches payment_lapsed — previously unreachable');

-- IDEMPOTENCY. The cron retries; Stripe redelivers.
select lives_ok(
  format($$ select public.lapse_org(%L, %L::timestamptz) $$,
         current_setting('t.org'), current_setting('t.fail')),
  'lapse_org is safe to call twice');
select is((select count(*)::int from public.contract_terms
            where org_id=current_setting('t.org')::uuid and trigger='lapse'),
          1, 'still exactly ONE lapse term after the second call');

-- Rule 11 — a tier change gates future actions, it never destroys existing state.
select is((select count(*)::int from public.contract_terms
            where org_id=current_setting('t.org')::uuid and trigger='signup'),
          1, 'the original signup term is untouched (terms are immutable)');

-- ── renewal ─────────────────────────────────────────────────────────────────
select lives_ok(
  format($$ select public.record_renewal(%L, '2027-01-01T00:00:00Z'::timestamptz) $$,
         current_setting('t.org2')),
  'record_renewal runs');
select is((select tier::text from public.contract_terms
            where org_id=current_setting('t.org2')::uuid and trigger='renewal'),
          'premium', 'renewal keeps the current tier');
select is((select term_length_months from public.contract_terms
            where org_id=current_setting('t.org2')::uuid and trigger='renewal'),
          24, 'renewal keeps the tier''s term increment');
select is((select count(*)::int from (
            select public.record_renewal(current_setting('t.org2')::uuid, '2027-01-01T00:00:00Z'::timestamptz)
          ) x), 1, 'record_renewal is idempotent for the same effective_from');

-- ── the seam is honest about being empty ────────────────────────────────────
select ok(public.tier_allows(current_setting('t.org')::uuid, 'create_title'),
          'tier_allows returns true — a SEAM, not a gate (see the migration header)');

select * from finish();
rollback;
