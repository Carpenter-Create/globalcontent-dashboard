-- ============================================================================
-- 20260726000500_last_account_owner_guard.sql
--
-- INTENT: close C9. A sole account_owner can demote themselves to viewer and the org is
-- left with zero active owners, unrecoverable from the client side. Reproduced live in
-- every audit pass (b3-cross-org-isolation.mjs, case C9): the update succeeds and a
-- service-role count then returns zero active account_owners for that org.
--
-- WHY IT IS UNRECOVERABLE: accept_terms requires account_owner
-- (20260717000100:181-187), and manage_billing, manage_team and manage_settings all
-- resolve to account_owner alone (20260716000100:180-182). Nobody left in the org can
-- pay, change tier, or invite anyone back. It needs GC staff or service-role
-- intervention — an avoidable support incident that a constraint prevents outright.
--
-- WHY A TRIGGER AND NOT A CHECK: the invariant spans rows ("at least one active
-- account_owner per org"), and a CHECK constraint cannot see other rows. A partial
-- unique index cannot express "at least one" either. A constraint trigger is the only
-- form that fits.
--
-- WHY IT COVERS MORE THAN THE REPORTED CASE: memberships_update gates on manage_team,
-- which is account_owner-only, so the reachable paths are an owner demoting themselves
-- or an owner removing/demoting a co-owner. Both are the same invariant, so the trigger
-- keys on the transition rather than on who performed it. DELETE is covered too — there
-- is no DELETE policy today (golden rule 2), but the guard should not depend on that
-- staying true.
--
-- DEFERRABLE INITIALLY IMMEDIATE, not INITIALLY DEFERRED. Deferring sounds safer and is
-- worse here: the check would only run at COMMIT, so the error surfaces detached from the
-- statement that caused it. And it buys nothing operationally — PostgREST gives every
-- request its own transaction, so a UI handover is already two transactions (promote B,
-- then demote A) and passes either way. IMMEDIATE fires at statement end and returns a
-- clean, attributable error. Still DEFERRABLE, so a genuine single-transaction handover
-- can opt in with `set constraints memberships_last_owner_guard deferred`.
--
-- DESTRUCTIVE OPS: creates a function and a constraint trigger on public.memberships.
-- No data changes, no policy changes. Forward-only and idempotent.
-- ============================================================================

create or replace function public.tg_memberships_last_owner_guard()
  returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  v_org       uuid := coalesce(old.org_id, new.org_id);
  v_remaining int;
begin
  -- Only interesting when an ACTIVE OWNER stops being one. Everything else is a no-op:
  -- promoting someone, editing a viewer, changing an already-inactive row.
  if tg_op = 'UPDATE'
     and old.role = 'account_owner' and old.status = 'active'
     and new.role = 'account_owner' and new.status = 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and not (old.role = 'account_owner' and old.status = 'active') then
    return new;
  end if;
  if tg_op = 'DELETE'
     and not (old.role = 'account_owner' and old.status = 'active') then
    return old;
  end if;

  select count(*) into v_remaining
  from public.memberships m
  where m.org_id = v_org
    and m.role = 'account_owner'
    and m.status = 'active';

  if v_remaining = 0 then
    raise exception
      'Organization % would be left with no active account owner. Promote another member to account_owner first.',
      v_org
      using errcode = 'raise_exception',
            hint = 'Promote another member first; the two changes may be separate requests.';
  end if;

  return coalesce(new, old);
end;
$$;

-- Constraint trigger, IMMEDIATE by default (see header): fires at statement end, so a
-- bare self-demotion fails where it happens, and promote-then-demote across two requests
-- still passes.
drop trigger if exists memberships_last_owner_guard on public.memberships;
create constraint trigger memberships_last_owner_guard
  after update or delete on public.memberships
  deferrable initially immediate
  for each row execute function public.tg_memberships_last_owner_guard();

-- Never called directly; triggers fire regardless of the invoker's EXECUTE privilege
-- (checked at CREATE TRIGGER, verified in audit pass 3). Consistent with 20260726000400.
revoke execute on function public.tg_memberships_last_owner_guard() from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- NOT ADDRESSED HERE, deliberately: an org can still reach zero active owners by a
-- route this trigger does not see — the owner's auth.users row being deleted. That is
-- blocked today by memberships.user_id being ON DELETE RESTRICT (20260716000100:77-79),
-- so the deletion fails rather than orphaning the org. When the account-closure path in
-- remediation A6 is built, it has to handle owner reassignment explicitly; this trigger
-- will not do it for you.
-- ----------------------------------------------------------------------------
