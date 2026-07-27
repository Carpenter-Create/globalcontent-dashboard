-- ============================================================================
-- 20260726000400_revoke_public_execute_on_functions.sql
--
-- INTENT: fix the revoke idiom, not just its one visible casualty.
--
-- THE BUG: PostgreSQL grants EXECUTE on every new function to PUBLIC by default.
-- `revoke execute ... from anon` does not remove that — PUBLIC is a separate grantee.
-- Two migrations tried to lock down can_deliver:
--   20260718000200_rights_grants.sql:193      revoke ... from anon
--   20260718000400_rights_grant_hardening.sql:84  revoke ... from authenticated
--       (commented "Least privilege: no client caller for can_deliver yet")
-- Both succeeded at what they said and achieved nothing, because the ACL keeps its
-- leading `=X/postgres` entry — PUBLIC — and PUBLIC includes anon and authenticated.
-- has_function_privilege('anon', 'can_deliver', 'EXECUTE') is still true today.
--
-- Contrast create_title, whose migration revokes `from public, anon` and whose ACL
-- correctly has no `=X` entry. Same author, same week — so this is a habit that mostly
-- holds rather than a rule that always does, which is why this migration sweeps all of
-- them instead of patching the one that was reported.
--
-- THE AUDIT: 8 of 40 functions in `public` carry a leading `=`. All 8 are handled below,
-- in three groups. Nothing else in the schema has an implicit PUBLIC grant (no function
-- has a NULL proacl).
--
-- DESTRUCTIVE OPS: REVOKE only. No function body changes, no signature changes, so no
-- TS type regeneration. Forward-only and idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- GROUP 1 — the reported one. GC-only rule-12 gate with no client caller.
--
-- can_deliver(title_id, rights_type, territory, at) -> boolean is SECURITY DEFINER with
-- no tenant check, so while PUBLIC holds EXECUTE an unauthenticated caller who knows a
-- title UUID can enumerate that title's rights coverage across all 21 rights types and
-- every territory. Title UUIDs are v4 and not exposed publicly, so this is an oracle
-- requiring prior knowledge rather than an open leak — but the two revokes above were
-- meant to close it and did not.
-- ----------------------------------------------------------------------------
revoke execute on function
  public.can_deliver(uuid, public.rights_type, text, timestamptz)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- GROUP 2 — PUBLIC removed, explicit grants KEPT. These are load-bearing.
--
-- member_can is referenced by 21 RLS policies and is_gc_staff by 16. Policy expressions
-- are evaluated with the querying role's privileges, so anon/authenticated must retain
-- EXECUTE or every policy on every table fails. Only the redundant PUBLIC entry goes.
-- Verified in a rolled-back transaction: after revoking PUBLIC only, a query as
-- `authenticated` with JWT claims still evaluated the titles policy correctly.
--
-- gc_check_digit is used in the titles.catalog_id GENERATED column. Generated-column
-- expressions ARE evaluated with the inserting role's privileges — verified: revoking
-- it from authenticated entirely makes an insert fail with "permission denied for
-- function gc_check_digit". Today only the SECURITY DEFINER create_title inserts into
-- titles, so a full revoke would not break the app right now, but it would arm a trap
-- for any future direct-insert path. PUBLIC-only revoke verified safe: insert as
-- authenticated still succeeds and produces the right check digit.
--
-- territories_overlap is a pure helper used inside create_delivery and
-- same_work_conflicts. Same treatment for consistency.
-- ----------------------------------------------------------------------------
revoke execute on function public.member_can(uuid, uuid, text) from public;
revoke execute on function public.is_gc_staff(uuid) from public;
revoke execute on function public.gc_check_digit(bigint) from public;
revoke execute on function
  public.territories_overlap(public.territory_mode, text[], public.territory_mode, text[])
  from public;

-- Restated so the intended grants are explicit rather than merely surviving.
grant execute on function public.member_can(uuid, uuid, text) to anon, authenticated, service_role;
grant execute on function public.is_gc_staff(uuid) to anon, authenticated, service_role;
grant execute on function public.gc_check_digit(bigint) to authenticated, service_role;
grant execute on function
  public.territories_overlap(public.territory_mode, text[], public.territory_mode, text[])
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- GROUP 3 — trigger functions. EXECUTE removed from everyone.
--
-- A trigger function's EXECUTE privilege is checked when the trigger is CREATED, not
-- when it fires. Verified in a rolled-back transaction: with tg_audit revoked from
-- public, anon, authenticated AND service_role, an INSERT performed as `authenticated`
-- still fired the trigger and wrote its audit_log row. So this costs nothing.
--
-- It is also the other half of 20260726000300. That migration removes the TRIGGER
-- privilege on tables; this removes the only PUBLIC-executable functions that a role
-- holding TRIGGER could have attached. Belt and braces on a path that is not reachable
-- through PostgREST today.
-- ----------------------------------------------------------------------------
revoke execute on function public.tg_audit() from public, anon, authenticated, service_role;
revoke execute on function public.tg_set_updated_at() from public, anon, authenticated, service_role;
revoke execute on function public.tg_titles_catalog_no_immutable() from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Verify at apply time: no function in public may retain a PUBLIC grant.
-- ----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and (p.proacl is null or exists (select 1 from unnest(p.proacl) a where a::text like '=%'));

  if v_bad is not null then
    raise exception 'functions still carrying a PUBLIC execute grant: %', v_bad;
  end if;

  raise notice 'no function in public retains a PUBLIC execute grant';
end $$;

-- ----------------------------------------------------------------------------
-- HOUSE RULE, for whoever writes the next migration: always
--     revoke execute on function public.f(...) from public, anon;
-- never `from anon` alone. The `public` in that list is the grantee PUBLIC, not the
-- schema. Omitting it is a no-op that reads like a lockdown.
-- ----------------------------------------------------------------------------
