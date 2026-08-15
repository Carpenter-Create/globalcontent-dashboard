-- 20260815000200_gc_client_directory_tier.sql
--
-- INTENT: add contract tier and billing health to gc_client_directory (20260815000100) so
-- /gc/clients answers "what did this client sign, and is their money arriving" without a
-- second query per row.
--
-- ⚠ WHY NOT `effective_to is null` TO FIND THE CURRENT TERM. Nothing in this schema ever
-- writes contract_terms.effective_to — not signup (20260717000100), not renewal, not lapse
-- (20260801000100). It is null on EVERY row, including superseded ones. Terms are immutable
-- (rule 6/golden rule 3): a lapse APPENDS an 'access' row rather than closing the Pro one.
-- The current term is therefore the greatest effective_from, and a future reader who
-- "corrects" this to effective_to would show a lapsed client their old Pro tier.
--
-- ⚠ TWO FACTS, NOT ONE. contract_terms.tier is what the client agreed to (immutable, audited,
-- and what the revenue module reads). subscriptions.status is what Stripe is billing. They
-- diverge exactly when it matters: a failed card sits at 'past_due' for 30 days while the
-- contract still says Pro, until lapse_org appends the access row. Both are returned; the page
-- decides how to render the divergence. Neither is derived from the other.
--
-- ⚠ A MISSING subscriptions ROW IS NORMAL. Access is $0 annual, so an Access client has no
-- Stripe subscription at all. Absence means "no annual billing", never "unpaid".
--
-- Why DROP and recreate rather than CREATE OR REPLACE: a set-returning function's OUT columns
-- cannot change under REPLACE. The migration runs in one transaction, so there is no window
-- where the function does not exist.
--
-- DESTRUCTIVE OPS (approved before apply): DROP FUNCTION + CREATE FUNCTION + grants. No table,
-- column, policy, trigger, or row changes. Forward-only.
-- ROLLBACK: re-apply 20260815000100's definition (the pre-tier signature).

drop function if exists public.gc_client_directory(integer);

create function public.gc_client_directory(p_limit integer default 500)
  returns table (
    user_id             uuid,
    email               text,
    org_id              uuid,
    organization        text,
    org_status          public.org_status,
    role                public.org_role,
    joined_at           timestamptz,
    last_sign_in        timestamptz,
    tier                public.tier_enum,
    term_expires_at     timestamptz,
    subscription_status text
  )
  language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;

  return query
    select u.id, u.email::text, o.id, o.name, o.status, m.role, m.created_at, u.last_sign_in_at,
           ct.tier, ct.expires_at, s.status
    from public.memberships m
    join public.organizations o on o.id = m.org_id
    join auth.users u          on u.id = m.user_id
    -- Current term = greatest effective_from. See the effective_to note above.
    left join lateral (
      select t.tier, t.expires_at
      from public.contract_terms t
      where t.org_id = o.id
      order by t.effective_from desc, t.created_at desc
      limit 1
    ) ct on true
    -- Most recent subscription row; null for Access and for orgs that never paid.
    left join lateral (
      select sub.status
      from public.subscriptions sub
      where sub.org_id = o.id
      order by sub.created_at desc
      limit 1
    ) s on true
    where m.status = 'active'
    order by o.name, u.email
    limit greatest(coalesce(p_limit, 0), 0);
end; $$;

revoke execute on function public.gc_client_directory(integer) from public, anon;
grant  execute on function public.gc_client_directory(integer) to authenticated;

comment on function public.gc_client_directory(integer) is
  'GC-only: active client seats with org, current contract tier, and Stripe billing status. Display read, never an authorization input.';
