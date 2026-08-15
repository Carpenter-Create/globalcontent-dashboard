-- 20260815000100_gc_client_directory.sql
--
-- INTENT: GC needs one place to see which person belongs to which client org. Supabase's
-- Auth → Users dashboard cannot show it (fixed column set, no Organization column), and no
-- existing read pairs a user with a role: org_notification_recipients (20260721000400)
-- returns emails only, with no user_id, so a role cannot be attributed to a person. Powers
-- the /gc/clients operator page.
--
-- Why an RPC and not a view or the service-role admin client: same reasoning as
-- 20260721000400 — a read that exposes auth.users goes through a SECURITY DEFINER function
-- with an explicit is_gc_staff gate, so the gate travels with the data and the service-role
-- key stays out of request-scoped server code. Emails (PII) are returned ONLY to GC staff,
-- and only for active memberships.
--
-- Not an authorization surface: this is a read for humans. Nothing in RLS consults it.
--
-- DESTRUCTIVE OPS (approved before apply): CREATE FUNCTION + grants only. No table, column,
-- policy, trigger, or row changes. Forward-only.
-- ROLLBACK: drop function public.gc_client_directory(integer);

create or replace function public.gc_client_directory(p_limit integer default 500)
  returns table (
    user_id      uuid,
    email        text,
    org_id       uuid,
    organization text,
    org_status   public.org_status,
    role         public.org_role,
    joined_at    timestamptz,
    last_sign_in timestamptz
  )
  language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;

  -- Bounded like every other list read (src/lib/list-bounds.ts): a directory that grows
  -- past the cap must paginate deliberately, not silently return a truncated page that
  -- looks complete.
  return query
    select u.id, u.email::text, o.id, o.name, o.status, m.role, m.created_at, u.last_sign_in_at
    from public.memberships m
    join public.organizations o on o.id = m.org_id
    join auth.users u          on u.id = m.user_id
    where m.status = 'active'
    order by o.name, u.email
    limit greatest(coalesce(p_limit, 0), 0);
end; $$;

revoke execute on function public.gc_client_directory(integer) from public, anon;
grant  execute on function public.gc_client_directory(integer) to authenticated;

comment on function public.gc_client_directory(integer) is
  'GC-only: active client seats with the org they belong to. Display read, never an authorization input.';
