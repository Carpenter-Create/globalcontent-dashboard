-- ============================================================================
-- 20260801000100_tier_rates_and_lapse.sql
--
-- INTENT: give `contract_terms.revenue_share_rate_bp` a real value, and make the lapse
-- transition possible at all.
--
-- WHAT WAS WRONG: both term-writing RPCs hardcoded `v_rate int := 0`, so **every contract
-- term in production states the client's revenue share is 0%.** All three rows are test orgs
-- (`Carpenter Test`, `Carpenter Test 2`, `Test 3`), so no real agreement is affected — but the
-- revenue module reads this column and nothing else (rule 8), and 0 looks like a number rather
-- than a missing one.
--
-- ⚠ WHICH SIDE OF THE SPLIT IS STORED — read this before using the column.
--     `revenue_share_rate_bp` holds THE CLIENT'S SHARE, in basis points.
--     GC's share is `10000 - revenue_share_rate_bp`, derived by subtraction (rule 7).
-- This is the number the pricing sheet calls "Your Revenue Share" and the number the agreement
-- quotes to the client, so storing anything else guarantees an inverted statement eventually.
-- Rates from the owner's pricing sheet, 2026-08-01: Access 80% · Pro 80% · Premium 85%.
--
-- TERMS ARE IMMUTABLE (rule 6), so the three existing 0-bp rows are left exactly as they are.
-- They are wrong and they are history. A correcting term is a new row, not an UPDATE — and for
-- test orgs it is not worth writing one.
--
-- LAPSE. Rule 8: system-initiated terms come from webhooks/cron, lapse has no event, use
-- `lapsed_at + 30 days`, and the job must be idempotent. Owner's decisions, 2026-08-01:
--   * the 30 days run from the FIRST failed charge, not from Stripe's final cancellation
--   * a lapsed org is forced to Access — including the Access revenue share
--   * reinstate is automatic while the agreement term still runs, new clickwrap once expired
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO: enforce anything. Rule 11 says a tier change gates
-- future actions at the point of action and never sweeps. The gate needs a definition of what
-- Access permits, and there is none — `TIER_META` carries label/price/term/blurb and no limits.
-- So `tier_allows()` is created as an explicit seam that currently returns true, rather than
-- inventing restrictions. `lapse_org` records the transition correctly; nothing yet reads it.
--
-- ⚠ ALSO UNMODELLED, and it changes what "forced to Access" means: the pricing sheet puts
-- Access at **$0/year + $247/title**. There is no `fees` table in this schema at all. A lapsed
-- client is therefore moved to a pay-per-title plan whose charge cannot be recorded. Flagged
-- for the owner; not invented here.
--
-- DESTRUCTIVE OPS: creates three functions, replaces two. No table, column, policy or row is
-- touched. Forward-only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The rate table, as a function. ONE definition, so a repricing is one edit.
--    Not a `tiers` table: rule 6 says the rate is snapshotted onto the term and never read
--    back through an FK, so this is only ever consulted at WRITE time.
-- ----------------------------------------------------------------------------
create or replace function public.tier_revenue_share_bp(p_tier public.tier_enum)
  returns integer
  language sql immutable
as $$
  select case p_tier
    when 'access'  then 8000   -- client 80% / GC 20%
    when 'pro'     then 8000   -- client 80% / GC 20%
    when 'premium' then 8500   -- client 85% / GC 15%
  end;
$$;

comment on function public.tier_revenue_share_bp(public.tier_enum) is
  'Client revenue share in basis points, per the 2026-08-01 pricing sheet. GC''s share is '
  '10000 minus this (rule 7: derive the counterparty share by subtraction). Consulted at term '
  'WRITE time only — contract_terms snapshots the value (rule 6).';

revoke execute on function public.tier_revenue_share_bp(public.tier_enum) from public;
grant  execute on function public.tier_revenue_share_bp(public.tier_enum) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. The enforcement seam. Returns true for everything, on purpose.
--
--    Rule 11 requires enforcement at the point of action rather than a sweep, so the call
--    sites belong in the RPCs that perform actions — create_title, add_rights_grant,
--    create_delivery. They are NOT wired yet, because what Access permits is undefined.
--    Creating the seam empty is deliberate: it gives the gate one place to land, and it is
--    honest that no gate exists today. An empty function that returns true is visible; a
--    missing gate is not.
-- ----------------------------------------------------------------------------
create or replace function public.tier_allows(p_org uuid, p_action text)
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select true;   -- SEAM. No tier currently restricts any action — see the header.
$$;

comment on function public.tier_allows(uuid, text) is
  'SEAM, not a gate. Always true. Tier feature limits are undefined (TIER_META has no limits), '
  'so this exists to give enforcement one place to land rather than scattering it later. '
  'Wire call sites at the point of action per rule 11 — never as a sweep.';

revoke execute on function public.tier_allows(uuid, text) from public;
grant  execute on function public.tier_allows(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. lapse_org — the transition that was impossible. `payment_lapsed` had NO writer anywhere
--    in the schema while the UI already rendered a label for it (page.tsx:25).
--
--    IDEMPOTENT, as rule 8 requires: a second call for the same org and the same lapse date
--    is a no-op, because the cron will retry and Stripe redelivers out of order.
--
--    Rule 11 compliance: this writes a TERM and a STATUS. It does not touch titles, deliveries
--    or rights grants. Nothing is taken down.
-- ----------------------------------------------------------------------------
create or replace function public.lapse_org(p_org uuid, p_first_failure timestamptz)
  returns uuid
  language plpgsql security definer set search_path = public
as $$
declare
  v_effective timestamptz := p_first_failure + interval '30 days';
  v_existing  uuid;
  v_doc       uuid;
  v_id        uuid;
begin
  if auth.uid() is not null and not public.is_gc_staff(auth.uid()) then
    raise exception 'Not authorized';
  end if;

  -- IDEMPOTENCY. Keyed on (org, trigger, effective_from) rather than "has any lapse term",
  -- so a SECOND genuine lapse after a reinstate can still be recorded.
  select id into v_existing
  from public.contract_terms
  where org_id = p_org and trigger = 'lapse' and effective_from = v_effective;
  if found then
    return v_existing;
  end if;

  -- Carry the source document forward from the org's current term. The lapse is not a new
  -- agreement — it is the consequence of the one they already signed.
  select source_document_id into v_doc
  from public.contract_terms
  where org_id = p_org
  order by effective_from desc
  limit 1;

  insert into public.contract_terms
    (org_id, tier, revenue_share_rate_bp, effective_from, term_length_months, expires_at,
     trigger, source_document_id)
  values
    (p_org, 'access', public.tier_revenue_share_bp('access'), v_effective, 12,
     v_effective + interval '12 months', 'lapse', v_doc)
  returning id into v_id;

  update public.organizations set status = 'payment_lapsed' where id = p_org;

  return v_id;
end;
$$;

revoke execute on function public.lapse_org(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.lapse_org(uuid, timestamptz) to service_role;

-- ----------------------------------------------------------------------------
-- 4. record_renewal — the term that keeps contract_terms true.
--
--    Without this the table shows one `signup` row for the life of the account, and rule 8
--    says the math reads terms only. A statement computed a year from now against a terms
--    table that never recorded a renewal is untraceable and wrong, and it looks right.
--
--    `effective_from` comes from the STRIPE EVENT timestamp, never now() (rule 8) — which is
--    why it is a required argument rather than defaulted.
-- ----------------------------------------------------------------------------
create or replace function public.record_renewal(p_org uuid, p_effective_from timestamptz)
  returns uuid
  language plpgsql security definer set search_path = public
as $$
declare
  v_tier   public.tier_enum;
  v_months int;
  v_doc    uuid;
  v_exist  uuid;
  v_id     uuid;
begin
  if auth.uid() is not null and not public.is_gc_staff(auth.uid()) then
    raise exception 'Not authorized';
  end if;

  select tier, term_length_months, source_document_id
    into v_tier, v_months, v_doc
  from public.contract_terms
  where org_id = p_org
  order by effective_from desc
  limit 1;
  if not found then
    raise exception 'Cannot renew an org with no existing term';
  end if;

  select id into v_exist
  from public.contract_terms
  where org_id = p_org and trigger = 'renewal' and effective_from = p_effective_from;
  if found then
    return v_exist;
  end if;

  insert into public.contract_terms
    (org_id, tier, revenue_share_rate_bp, effective_from, term_length_months, expires_at,
     trigger, source_document_id)
  values
    (p_org, v_tier, public.tier_revenue_share_bp(v_tier), p_effective_from, v_months,
     p_effective_from + (v_months || ' months')::interval, 'renewal', v_doc)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.record_renewal(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.record_renewal(uuid, timestamptz) to service_role;

-- ----------------------------------------------------------------------------
-- 5. The two existing term writers stop hardcoding zero.
--    Generated from pg_get_functiondef; only the `v_rate` initialiser differs.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_terms(p_tier tier_enum, p_terms_version text, p_content_hash text, p_rendered_text text, p_ip inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_doc uuid;
  v_rate int := public.tier_revenue_share_bp('access');  -- was 0 (§21.5 placeholder)
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select m.org_id into v_org
  from public.memberships m
  where m.user_id = v_uid and m.status = 'active' and m.role = 'account_owner'
  limit 1;
  if v_org is null then
    raise exception 'Only the account owner can accept the agreement';
  end if;

  insert into public.source_documents (org_id, kind, provided_by, content_hash, raw)
  values (v_org, 'agreement', v_uid, p_content_hash,
          jsonb_build_object('terms_version', p_terms_version, 'tier', p_tier, 'text', p_rendered_text))
  returning id into v_doc;

  insert into public.contract_assents
    (org_id, user_id, terms_version, content_hash, source_document_id, ip, user_agent)
  values (v_org, v_uid, p_terms_version, p_content_hash, v_doc, p_ip, p_user_agent);

  if p_tier = 'access' then
    insert into public.contract_terms
      (org_id, tier, revenue_share_rate_bp, effective_from, term_length_months, expires_at, trigger, source_document_id)
    values (v_org, 'access', v_rate, now(), 12, now() + interval '12 months', 'signup', v_doc);
    update public.organizations set status = 'active' where id = v_org;
    return jsonb_build_object('org_id', v_org, 'source_document_id', v_doc, 'needs_payment', false);
  else
    update public.organizations set status = 'awaiting_payment' where id = v_org;
    return jsonb_build_object('org_id', v_org, 'source_document_id', v_doc, 'needs_payment', true);
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.finalize_paid_signup(p_org uuid, p_tier tier_enum, p_stripe_customer text, p_stripe_subscription text, p_price_cents integer, p_effective_from timestamp with time zone, p_source_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_term_months int := case when p_tier = 'premium' then 24 else 12 end;
  v_rate int := public.tier_revenue_share_bp(p_tier);  -- was 0 (§21.5 placeholder)
begin
  insert into public.subscriptions
    (org_id, tier, stripe_customer_id, stripe_subscription_id, status, annual_price_cents, current_period_end)
  values (p_org, p_tier, p_stripe_customer, p_stripe_subscription, 'active', p_price_cents,
          p_effective_from + interval '1 year')
  on conflict (stripe_subscription_id) do nothing;

  -- Idempotency: one term per accepted agreement (source document).
  if not exists (
    select 1 from public.contract_terms where source_document_id = p_source_document_id
  ) then
    insert into public.contract_terms
      (org_id, tier, revenue_share_rate_bp, effective_from, term_length_months, expires_at, trigger, source_document_id)
    values (p_org, p_tier, v_rate, p_effective_from, v_term_months,
            p_effective_from + (v_term_months || ' months')::interval, 'signup', p_source_document_id);
  end if;

  update public.organizations set status = 'active'
  where id = p_org and status = 'awaiting_payment';
end $function$
;


-- ----------------------------------------------------------------------------
-- 6. Prove it at apply time.
-- ----------------------------------------------------------------------------
do $$
begin
  if public.tier_revenue_share_bp('access')  <> 8000 then raise exception 'access rate wrong';  end if;
  if public.tier_revenue_share_bp('pro')     <> 8000 then raise exception 'pro rate wrong';     end if;
  if public.tier_revenue_share_bp('premium') <> 8500 then raise exception 'premium rate wrong'; end if;

  -- No term writer may still hardcode a zero rate.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname in ('accept_terms','finalize_paid_signup')
      and p.prosrc ~ 'v_rate int := 0'
  ) then
    raise exception 'a term writer still hardcodes revenue_share_rate_bp = 0';
  end if;

  -- payment_lapsed must now be reachable — it had no writer at all before this file.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.prosrc like '%payment_lapsed%'
  ) then
    raise exception 'payment_lapsed is still unreachable';
  end if;

  raise notice 'rates live (80/80/85 client share); lapse and renewal terms now writable';
end $$;

-- ----------------------------------------------------------------------------
-- STILL OPEN, and each belongs to the owner rather than to this migration:
--
--   * Premium annual price. The pricing sheet says $1,997/yr; TIER_META and domain-spec §5
--     say $997, and renderAgreement() interpolates TIER_META — so the agreement a Premium
--     client signs today quotes $997. Not changed here: pricing is a founder decision.
--   * Access is $0/yr + $247 PER TITLE. No `fees` table exists, so that charge cannot be
--     recorded. A lapsed org is moved onto a pay-per-title plan the schema cannot bill.
--   * Access and Pro are both 80%, while domain-spec §5 says Access gives GC the highest
--     share. Tied, not contradictory — but the rate no longer distinguishes those two tiers.
--   * What Access actually restricts. `tier_allows()` is the seam; it returns true.
-- ----------------------------------------------------------------------------
