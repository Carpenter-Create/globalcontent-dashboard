-- 20260721000400_org_notification_recipients.sql
--
-- INTENT: the GC-Support notification channel is gaining an EMAIL leg (title rejected +
-- delivery update). To email the right people we need the email addresses of an org's active
-- members. Client emails live in auth.users.email (no profiles table). This RPC returns them,
-- gated to GC staff — the caller is always a GC operator who just created the notification.
--
-- Why an RPC and not the service-role admin client: rls-data-layer principle — reads go through
-- a SECURITY DEFINER RPC with an explicit auth gate, so the service-role key stays out of the
-- request-scoped server actions. is_gc_staff is checked inside, so it fails closed for anyone
-- else regardless of call site. Emails (PII) are returned ONLY to GC, only for active members.
--
-- DESTRUCTIVE OPS (approved before apply): CREATE FUNCTION + grants only. No table/row/policy
-- changes. Forward-only.

create or replace function public.org_notification_recipients(p_org_id uuid)
  returns setof text
  language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  return query
    select u.email::text
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
      and m.status = 'active'
      and u.email is not null;
end; $$;
revoke execute on function public.org_notification_recipients(uuid) from public, anon;
grant  execute on function public.org_notification_recipients(uuid) to authenticated;
