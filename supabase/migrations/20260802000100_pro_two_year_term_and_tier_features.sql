-- ============================================================================
-- 20260802000100_pro_two_year_term_and_tier_features.sql
--
-- Pricing sheet 8.1.26 changes two things against 7.19.26:
--   1. **Pro term: 1 year -> 2 year minimum.**
--   2. Ask Globee (AI Agent) is now included on Access.
-- Rates and prices are unchanged (85/80/80 client share; $1,997 / $497 / $0+$247).
--
-- WHY (1) IS MORE THAN A NUMBER. `finalize_paid_signup` hardcoded
-- `case when p_tier = 'premium' then 24 else 12 end`, and `TIER_META.pro.termMonths` is 12 —
-- and `renderAgreement()` interpolates TIER_META into the text the client signs and whose hash
-- is stored as the source document. **A Pro client signing today agrees to a 12-month term**
-- while the plan says 24. Same shape as the Premium price conflict: the binding document
-- disagrees with the product.
--
-- It also moves Pro across a line in the domain model. Spec §6: for Access and Pro the billing
-- anniversary and the term boundary coincide, so there is one date; Premium is the exception
-- with two (annual charge at month 12, expiry at 24). **Pro is now the same exception** —
-- billed annually inside a two-year term. Anything that assumes "anniversary == term boundary
-- for Pro" is now wrong. §5 and §6 are updated in this PR, per the rule that a decision not in
-- the spec gets recorded there in the same change.
--
-- Term length joins the rate in ONE place, for the same reason: a repricing should be one
-- edit, not a grep.
--
-- DESTRUCTIVE OPS: creates one function, replaces two. No table, column, policy or row is
-- touched. Forward-only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Term increments, single source. Consulted at term WRITE time only —
--    contract_terms snapshots the value, same as the rate (rule 6).
-- ----------------------------------------------------------------------------
create or replace function public.tier_term_months(p_tier public.tier_enum)
  returns integer
  language sql immutable
as $$
  select case p_tier
    when 'access'  then 12
    when 'pro'     then 24   -- was 12. Pricing sheet 8.1.26: "2 year minimum".
    when 'premium' then 24
  end;
$$;

comment on function public.tier_term_months(public.tier_enum) is
  'Term increment in months per the 2026-08-01 pricing sheet. Access 12, Pro 24, Premium 24. '
  'Pro moved from 12 on 2026-08-01, which also gives Pro two dates rather than one — annual '
  'charge at month 12, term expiry at month 24 (spec §6). Consulted at term WRITE time only.';

revoke execute on function public.tier_term_months(public.tier_enum) from public;
grant  execute on function public.tier_term_months(public.tier_enum) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. tier_allows — the seam from 20260801000100, now with the matrix behind it.
--
--    When that seam was written the feature split was undefined and the function returned
--    true for everything. The 8.1.26 sheet defines it, so it now answers properly.
--
--    STILL RETURNS TRUE FOR UNKNOWN ACTIONS, and that is deliberate. This gates *features*,
--    not authorization — RLS and member_can/gc_can do authorization. A typo'd action name must
--    not silently deny a paying client access to their catalog. Fail-open is correct here and
--    would be wrong one layer down; the two are different jobs.
--
--    Access excludes: the three Audits and Co-Production qualification.
--    Access INCLUDES Ask Globee as of 8.1.26 — it did not on 7.19.26.
--    Professional Services is a DISCOUNT RATE (20% / 10% / list), not a boolean, so it is not
--    modelled here. There is no fees table to apply it to yet.
-- ----------------------------------------------------------------------------
create or replace function public.tier_allows(p_org uuid, p_action text)
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select case
    when p_action in ('artwork_audit','metadata_audit','trailer_audit','coproduction_qualify')
      then coalesce(
             (select ct.tier <> 'access'
                from public.contract_terms ct
               where ct.org_id = p_org
                 and ct.effective_from <= now()
               order by ct.effective_from desc
               limit 1),
             false)   -- no effective term = no entitlement
    else true         -- unknown or unrestricted action: fail OPEN. See the header.
  end;
$$;

comment on function public.tier_allows(uuid, text) is
  'Tier FEATURE entitlement, not authorization. Reads the org''s currently-effective '
  'contract_terms row. Unknown actions return true by design — RLS does authorization, and a '
  'typo must not lock a client out of their catalog. Access excludes artwork_audit, '
  'metadata_audit, trailer_audit and coproduction_qualify (pricing sheet 8.1.26). Ask Globee '
  'is included on Access as of that sheet.';

revoke execute on function public.tier_allows(uuid, text) from public;
grant  execute on function public.tier_allows(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. finalize_paid_signup stops hardcoding the term. Generated from
--    pg_get_functiondef; only the v_term_months initialiser differs.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_paid_signup(p_org uuid, p_tier tier_enum, p_stripe_customer text, p_stripe_subscription text, p_price_cents integer, p_effective_from timestamp with time zone, p_source_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_term_months int := public.tier_term_months(p_tier);  -- was: premium 24 else 12 (Pro moved to 24, 8.1.26)
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
-- 4. Prove it at apply time.
-- ----------------------------------------------------------------------------
do $$
begin
  if public.tier_term_months('access')  <> 12 then raise exception 'access term wrong';  end if;
  if public.tier_term_months('pro')     <> 24 then raise exception 'pro term wrong (8.1.26: 2 years)'; end if;
  if public.tier_term_months('premium') <> 24 then raise exception 'premium term wrong'; end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='finalize_paid_signup'
      and p.prosrc ~ 'then 24 else 12 end'
  ) then
    raise exception 'finalize_paid_signup still hardcodes the term increment';
  end if;

  -- The seam must no longer be a stub: it has to be capable of returning false.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='tier_allows' and p.prosrc like '%artwork_audit%'
  ) then
    raise exception 'tier_allows is still the empty seam';
  end if;

  raise notice 'pro term = 24 months; tier_allows now answers the 8.1.26 feature matrix';
end $$;

-- ----------------------------------------------------------------------------
-- STILL OPEN, owner's call, unchanged by this file:
--   * Premium annual price — sheet $1,997/yr vs TIER_META and spec §5 $997. renderAgreement()
--     interpolates TIER_META, so the signed document says $997.
--   * Access $0/yr + $247 PER TITLE. No fees table exists; the charge cannot be recorded.
--   * Professional Services discount (20% / 10% / list) — a rate, not a flag. Needs the fees
--     table before it can mean anything.
-- ----------------------------------------------------------------------------
