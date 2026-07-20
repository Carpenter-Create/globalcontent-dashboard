-- ============================================================================
-- 20260720000700_notifications.sql
--
-- INTENT: the §20 Global Content Support push channel, in-app (design 2026-07-20-
-- notifications-inapp). GC actions the client must know about (title rejection,
-- delivery-status transitions) create an org-scoped notification that says why (§19).
-- Per-user read state (notification_reads) so unread is correct with >1 member.
-- Written only via create_notification (GC-only); read state via mark_notifications_read.
-- sender = gc_support (Globee never pushes, §20). Email + findings-/system-driven
-- notices are deferred seams.
--
-- DESTRUCTIVE OPS (approved before apply): create 2 enums + 2 tables + trigger + 4
-- functions; revokes. Forward-only + idempotent where possible.
-- ============================================================================

do $$ begin create type public.notification_kind   as enum ('title_rejected','delivery_update');
exception when duplicate_object then null; end $$;
do $$ begin create type public.notification_sender as enum ('gc_support','globee');
exception when duplicate_object then null; end $$;

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete restrict,
  kind        public.notification_kind not null,
  sender      public.notification_sender not null default 'gc_support',
  title       text not null,
  body        text not null,               -- "says why" (§19)
  source_refs jsonb not null,              -- {title_id?, delivery_id?, reason?, status?}
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists notifications_org_created_idx on public.notifications (org_id, created_at desc);

create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete restrict,
  user_id         uuid not null references auth.users(id)          on delete restrict,
  read_at         timestamptz not null default now(),
  primary key (notification_id, user_id)
);

drop trigger if exists audit_notifications on public.notifications;
create trigger audit_notifications after insert or update or delete on public.notifications
  for each row execute function public.tg_audit();

-- ---- RLS ------------------------------------------------------------------
alter table public.notifications      enable row level security;
alter table public.notification_reads enable row level security;
revoke all on public.notifications      from anon;
revoke all on public.notification_reads from anon;
revoke insert, update, delete on public.notifications from authenticated;  -- RPC-only
revoke update, delete on public.notification_reads from authenticated;     -- read rows immutable
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (public.is_gc_staff(auth.uid()) or public.member_can(auth.uid(), org_id, 'view'));
-- a user may see + create only their OWN read rows (write also goes via the RPC below)
drop policy if exists notification_reads_own on public.notification_reads;
create policy notification_reads_own on public.notification_reads for select to authenticated
  using (user_id = auth.uid());
drop policy if exists notification_reads_insert_own on public.notification_reads;
create policy notification_reads_insert_own on public.notification_reads for insert to authenticated
  with check (user_id = auth.uid());

-- ---- create_notification (GC-only) ----------------------------------------
create or replace function public.create_notification(
  p_org_id uuid, p_kind public.notification_kind, p_title text, p_body text, p_source_refs jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  insert into public.notifications (org_id, kind, sender, title, body, source_refs, created_by)
  values (p_org_id, p_kind, 'gc_support', p_title, p_body, coalesce(p_source_refs, '{}'::jsonb), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.create_notification(uuid, public.notification_kind, text, text, jsonb) from public, anon;
grant  execute on function public.create_notification(uuid, public.notification_kind, text, text, jsonb) to authenticated;

-- ---- mark_notifications_read: caller's own read state, only for visible notices ----
create or replace function public.mark_notifications_read(p_ids uuid[])
  returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.notification_reads (notification_id, user_id)
  select n.id, auth.uid()
  from public.notifications n
  where n.id = any (p_ids)
    and (public.is_gc_staff(auth.uid()) or public.member_can(auth.uid(), n.org_id, 'view'))
  on conflict (notification_id, user_id) do nothing;
end; $$;
revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant  execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ---- my_notifications / my_unread_count (client inbox + nav badge) ---------
create or replace function public.my_notifications()
  returns table (id uuid, org_id uuid, kind public.notification_kind, title text, body text,
                 source_refs jsonb, created_at timestamptz, unread boolean)
  language sql stable security definer set search_path = public as $$
  select n.id, n.org_id, n.kind, n.title, n.body, n.source_refs, n.created_at,
         not exists (select 1 from public.notification_reads r
                     where r.notification_id = n.id and r.user_id = auth.uid()) as unread
  from public.notifications n
  where public.member_can(auth.uid(), n.org_id, 'view')
  order by n.created_at desc;
$$;
revoke execute on function public.my_notifications() from public, anon;
grant  execute on function public.my_notifications() to authenticated;

create or replace function public.my_unread_count()
  returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.notifications n
  where public.member_can(auth.uid(), n.org_id, 'view')
    and not exists (select 1 from public.notification_reads r
                    where r.notification_id = n.id and r.user_id = auth.uid());
$$;
revoke execute on function public.my_unread_count() from public, anon;
grant  execute on function public.my_unread_count() to authenticated;
