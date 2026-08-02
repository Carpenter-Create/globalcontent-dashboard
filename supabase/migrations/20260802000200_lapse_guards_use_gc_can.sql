-- ============================================================================
-- 20260802000200_lapse_guards_use_gc_can.sql
--
-- FIXES A REGRESSION I INTRODUCED IN 20260801000100, caught by
-- scripts/security/verify-prod-end-state.sql check G3 minutes after that migration reached
-- production.
--
-- `lapse_org` and `record_renewal` guarded on `not public.is_gc_staff(auth.uid())` — the exact
-- role-agnostic pattern 20260727000100 spent 15 functions removing. Any gc_staff row passed,
-- including `gc_legal`, whose written scope is "read all, write nothing". These are writes.
--
-- Both are already revoked from anon/authenticated and granted only to service_role, so the
-- practical exposure was nil — the webhook and cron are the only callers. That is exactly why
-- it is worth fixing rather than waving through: the guard is defence in depth, and defence in
-- depth that quietly admits the wrong roles is the kind of thing that becomes load-bearing
-- later without anyone re-reading it.
--
-- Now `gc_can(auth.uid(), 'operate')` — the same capability every other GC write requires.
--
-- Bodies generated from pg_get_functiondef; only the guard expression differs.
--
-- DESTRUCTIVE OPS: replaces two functions. Nothing else. Forward-only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lapse_org(p_org uuid, p_first_failure timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_effective timestamptz := p_first_failure + interval '30 days';
  v_existing  uuid;
  v_doc       uuid;
  v_id        uuid;
begin
  if auth.uid() is not null and not public.gc_can(auth.uid(), 'operate') then
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
$function$
;

CREATE OR REPLACE FUNCTION public.record_renewal(p_org uuid, p_effective_from timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tier   public.tier_enum;
  v_months int;
  v_doc    uuid;
  v_exist  uuid;
  v_id     uuid;
begin
  if auth.uid() is not null and not public.gc_can(auth.uid(), 'operate') then
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
$function$
;


do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc like '%is_gc_staff%'
    and p.proname not in ('is_gc_staff', 'member_can');
  if v_bad is not null then
    raise exception 'functions still gating on bare is_gc_staff: %', v_bad;
  end if;
  raise notice 'lapse_org and record_renewal now require gc_can(...,''operate''); G3 invariant restored';
end $$;
