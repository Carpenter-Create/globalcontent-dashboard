-- 20260720000300_screener_room.sql
-- INTENT: Portal-2 screener room (design 2026-07-20-asset-portal-slice-2). Per-title
-- screener_source; generalize portal_links with a purpose discriminator to share the
-- Portal-1 OTP gate; append-only screener_view_events capture; RPCs for GC link creation,
-- service-role stream resolution (no rule-12 gate — pitch view), and the GC per-viewer summary.
-- DESTRUCTIVE OPS (approved before apply): create types/table; ALTER titles + portal_links
-- (+CHECK, drop NOT NULLs); functions; revokes. Forward-only + idempotent.

do $$ begin create type public.screener_source as enum ('master','dedicated');
exception when duplicate_object then null; end $$;
alter table public.titles
  add column if not exists screener_source public.screener_source not null default 'master';

do $$ begin create type public.portal_link_purpose as enum ('master_download','screener_view');
exception when duplicate_object then null; end $$;
alter table public.portal_links
  add column if not exists purpose  public.portal_link_purpose not null default 'master_download',
  add column if not exists title_id uuid references public.titles(id) on delete restrict;
alter table public.portal_links alter column delivery_id drop not null;
alter table public.portal_links alter column asset_id    drop not null;
alter table public.portal_links drop constraint if exists portal_links_purpose_shape;
alter table public.portal_links add constraint portal_links_purpose_shape check (
  (purpose = 'master_download' and delivery_id is not null and asset_id is not null and title_id is null)
  or (purpose = 'screener_view' and title_id is not null and delivery_id is null and asset_id is null)
);
create index if not exists portal_links_title_idx on public.portal_links (title_id);

do $$ begin create type public.screener_event as enum ('play','pause','seek','progress','ended');
exception when duplicate_object then null; end $$;
create table if not exists public.screener_view_events (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.portal_sessions(id) on delete restrict,
  link_id          uuid not null references public.portal_links(id)    on delete restrict,
  event_type       public.screener_event not null,
  position_seconds int  not null default 0,
  runtime_seconds  int,
  occurred_at      timestamptz not null default now()
);
create index if not exists screener_view_events_link_idx    on public.screener_view_events (link_id);
create index if not exists screener_view_events_session_idx on public.screener_view_events (session_id);

alter table public.screener_view_events enable row level security;
revoke all on public.screener_view_events from anon;
revoke insert, update, delete on public.screener_view_events from authenticated;
revoke update, delete on public.screener_view_events from service_role;  -- append-only (rule 5)
drop policy if exists screener_view_events_select on public.screener_view_events;
create policy screener_view_events_select on public.screener_view_events for select to authenticated
  using (public.is_gc_staff(auth.uid()));

-- create_screener_link (GC-only, screenable gate)
create or replace function public.create_screener_link(
  p_title_id uuid, p_token_hash text, p_expires_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_source public.screener_source; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select screener_source into v_source from public.titles where id = p_title_id;
  if not found then raise exception 'Title not found'; end if;
  if v_source = 'dedicated' then
    if not exists (select 1 from public.assets where title_id = p_title_id and kind = 'screener') then
      raise exception 'Screener source is set to dedicated but no screener has been uploaded';
    end if;
  else
    if not exists (select 1 from public.assets where title_id = p_title_id and kind = 'master') then
      raise exception 'No master asset to screen';
    end if;
  end if;
  if coalesce(btrim(p_token_hash), '') = '' then raise exception 'token_hash required'; end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expires_at must be in the future';
  end if;
  insert into public.portal_links (purpose, title_id, token_hash, created_by, expires_at)
  values ('screener_view', p_title_id, btrim(p_token_hash), auth.uid(),
          coalesce(p_expires_at, now() + interval '14 days'))
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.create_screener_link(uuid, text, timestamptz) from public, anon;
grant  execute on function public.create_screener_link(uuid, text, timestamptz) to authenticated;

-- portal_resolve_screener (service-role only; NO rule-12 gate — pitch view)
create or replace function public.portal_resolve_screener(p_session_token_hash text)
  returns table(storage_key text, link_id uuid, session_id uuid, title_id uuid)
  language plpgsql security definer set search_path = public as $$
declare
  v_sess public.portal_sessions%rowtype; v_link public.portal_links%rowtype;
  v_source public.screener_source; v_key text;
begin
  select * into v_sess from public.portal_sessions
    where token_hash = p_session_token_hash and revoked_at is null and expires_at > now();
  if not found then raise exception 'Session expired or not found'; end if;
  select * into v_link from public.portal_links
    where id = v_sess.link_id and purpose = 'screener_view' and revoked_at is null and expires_at > now();
  if not found then raise exception 'Link expired or revoked'; end if;
  select screener_source into v_source from public.titles where id = v_link.title_id;
  if v_source = 'dedicated' then
    select a.storage_key into v_key from public.assets a
      where a.title_id = v_link.title_id and a.kind = 'screener' order by a.created_at desc limit 1;
  else
    select a.storage_key into v_key from public.assets a
      where a.title_id = v_link.title_id and a.kind = 'master' order by a.created_at desc limit 1;
  end if;
  if v_key is null then raise exception 'Screener source asset not found'; end if;
  return query select v_key, v_link.id, v_sess.id, v_link.title_id;
end; $$;
revoke execute on function public.portal_resolve_screener(text) from public, anon, authenticated;
grant  execute on function public.portal_resolve_screener(text) to service_role;

-- screener_engagement (GC-only read; derived on read, rule 4)
create or replace function public.screener_engagement(p_link_id uuid)
  returns table(session_id uuid, name text, company text, email text,
                watched_pct int, completed boolean, replays int, last_viewed timestamptz)
  language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.company, s.email,
         coalesce(round(100.0 * max(e.position_seconds) / nullif(max(e.runtime_seconds), 0)), 0)::int,
         bool_or(e.event_type = 'ended')
           or coalesce(round(100.0 * max(e.position_seconds) / nullif(max(e.runtime_seconds),0)),0) >= 95,
         greatest(count(*) filter (where e.event_type = 'ended') - 1, 0)::int,
         max(e.occurred_at)
  from public.portal_sessions s
  join public.screener_view_events e on e.session_id = s.id
  where e.link_id = p_link_id and public.is_gc_staff(auth.uid())
  group by s.id, s.name, s.company, s.email;
$$;
revoke execute on function public.screener_engagement(uuid) from public, anon;
grant  execute on function public.screener_engagement(uuid) to authenticated;
