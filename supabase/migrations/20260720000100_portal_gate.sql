-- ============================================================================
-- 20260720000100_portal_gate.sql
--
-- INTENT: the asset-access portal GATE (design 2026-07-20-asset-portal-slice-1;
-- domain-spec §12/§13; golden rules 5/10/12/14). An account-less recipient opens
-- a single-purpose link, proves identity via an emailed code, and downloads a
-- delivery's master over a signed CloudFront URL. Four tables + three RPCs.
-- portal_access_events is the recipient-side provenance record (append-only;
-- audit_log is for authenticated org actions, which this is not).
--
-- Write model: portal_links via GC-only create/revoke RPCs; portal_otps /
-- portal_sessions / portal_access_events by the service-role route handlers
-- (service_role is the intended writer — no user write path — so, unlike the
-- repo's user-RPC tables, service_role is NOT revoked here; the append-only
-- table revokes UPDATE/DELETE from everyone incl. service_role). portal_resolve_
-- download holds the crown-jewel authz (session + rule-12 grant re-check).
--
-- DESTRUCTIVE OPS (approved before apply): create type + 4 tables + 3 functions;
-- revokes (incl. UPDATE/DELETE on the append-only table). Forward-only + idempotent.
-- ============================================================================

do $$ begin
  create type public.portal_event as enum ('room_viewed','otp_sent','otp_verified','download');
exception when duplicate_object then null; end $$;

create table if not exists public.portal_links (
  id          uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete restrict,
  asset_id    uuid not null references public.assets(id)     on delete restrict,
  token_hash  text not null unique,
  created_by  uuid references auth.users(id),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists portal_links_delivery_idx on public.portal_links (delivery_id);
create index if not exists portal_links_asset_idx    on public.portal_links (asset_id);

create table if not exists public.portal_otps (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references public.portal_links(id) on delete restrict,
  email       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int  not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists portal_otps_link_idx on public.portal_otps (link_id);

create table if not exists public.portal_sessions (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references public.portal_links(id) on delete restrict,
  token_hash  text not null unique,
  name        text not null,
  company     text not null,
  email       text not null,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists portal_sessions_link_idx on public.portal_sessions (link_id);

create table if not exists public.portal_access_events (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references public.portal_links(id) on delete restrict,
  session_id  uuid references public.portal_sessions(id),
  event_type  public.portal_event not null,
  email       text,
  name        text,
  company     text,
  ip          inet,
  user_agent  text,
  occurred_at timestamptz not null default now()
);
create index if not exists portal_access_events_link_idx on public.portal_access_events (link_id);
create index if not exists portal_access_events_at_idx   on public.portal_access_events (occurred_at desc);

-- ---- RLS: GC-only reads; no anon; no authenticated-user writes -------------
alter table public.portal_links         enable row level security;
alter table public.portal_otps          enable row level security;
alter table public.portal_sessions      enable row level security;
alter table public.portal_access_events enable row level security;

revoke all on public.portal_links, public.portal_otps, public.portal_sessions,
             public.portal_access_events from anon;
revoke insert, update, delete on public.portal_links, public.portal_otps,
             public.portal_sessions, public.portal_access_events from authenticated;
-- append-only (rule 5): even service_role cannot mutate access events.
revoke update, delete on public.portal_access_events from service_role;
-- Least privilege for service_role (the role the route handlers run under):
--  * portal_links is RPC-only-write (create_portal_link / revoke_portal_link). No route
--    writes it directly, so revoke ALL writes — a route can never hard-update/delete a link
--    and bypass the RPC's auth checks or rule-2's soft-revoke-only guarantee.
--  * portal_otps: routes INSERT + UPDATE (attempts / consumed_at) but never DELETE.
--  * portal_sessions: routes INSERT only in this slice (no UPDATE/DELETE).
revoke insert, update, delete on public.portal_links    from service_role;
revoke delete                 on public.portal_otps      from service_role;
revoke update, delete         on public.portal_sessions  from service_role;

drop policy if exists portal_links_select on public.portal_links;
create policy portal_links_select on public.portal_links for select to authenticated
  using (public.is_gc_staff(auth.uid()));
drop policy if exists portal_otps_select on public.portal_otps;
create policy portal_otps_select on public.portal_otps for select to authenticated
  using (public.is_gc_staff(auth.uid()));
drop policy if exists portal_sessions_select on public.portal_sessions;
create policy portal_sessions_select on public.portal_sessions for select to authenticated
  using (public.is_gc_staff(auth.uid()));
drop policy if exists portal_access_events_select on public.portal_access_events;
create policy portal_access_events_select on public.portal_access_events for select to authenticated
  using (public.is_gc_staff(auth.uid()));

-- ---- create_portal_link (GC-only) -----------------------------------------
create or replace function public.create_portal_link(
  p_delivery_id uuid, p_asset_id uuid, p_token_hash text, p_expires_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_title uuid; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  select title_id into v_title from public.deliveries where id = p_delivery_id;
  if not found then raise exception 'Delivery not found'; end if;
  if not exists (
    select 1 from public.assets
    where id = p_asset_id and title_id = v_title and kind = 'master'
  ) then raise exception 'Asset must be a master asset on the delivery''s title'; end if;
  if coalesce(btrim(p_token_hash), '') = '' then raise exception 'token_hash required'; end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expires_at must be in the future';
  end if;
  insert into public.portal_links (delivery_id, asset_id, token_hash, created_by, expires_at)
  values (p_delivery_id, p_asset_id, btrim(p_token_hash), auth.uid(),
          coalesce(p_expires_at, now() + interval '14 days'))
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.create_portal_link(uuid, uuid, text, timestamptz) from public, anon;
grant  execute on function public.create_portal_link(uuid, uuid, text, timestamptz) to authenticated;

-- ---- revoke_portal_link (GC-only) -----------------------------------------
create or replace function public.revoke_portal_link(p_link_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  update public.portal_links set revoked_at = coalesce(revoked_at, now()) where id = p_link_id;
  if not found then raise exception 'Link not found'; end if;
end; $$;
revoke execute on function public.revoke_portal_link(uuid) from public, anon;
grant  execute on function public.revoke_portal_link(uuid) to authenticated;

-- ---- portal_resolve_download (service-role only): session + rule-12 recheck -
create or replace function public.portal_resolve_download(p_session_token_hash text)
  returns table(storage_key text, link_id uuid, session_id uuid)
  language plpgsql security definer set search_path = public as $$
declare
  v_sess public.portal_sessions%rowtype;
  v_link public.portal_links%rowtype;
  v_deliv public.deliveries%rowtype;
begin
  select * into v_sess from public.portal_sessions
    where token_hash = p_session_token_hash and revoked_at is null and expires_at > now();
  if not found then raise exception 'Session expired or not found'; end if;

  select * into v_link from public.portal_links
    where id = v_sess.link_id and revoked_at is null and expires_at > now();
  if not found then raise exception 'Link expired or revoked'; end if;

  select * into v_deliv from public.deliveries where id = v_link.delivery_id;
  if not found then raise exception 'Delivery not found'; end if;

  -- Master download is only for a licensed placement that is still active: allow while the
  -- delivery is pending/delivered/live; block once it is rejected or taken_down (deal off /
  -- pulled). Allow-list is fail-closed for any future delivery_status value.
  if v_deliv.status not in ('pending','delivered','live') then
    raise exception 'This delivery is no longer active';
  end if;

  -- Rule 12: the delivery's SPECIFIC grant must still be active + in-window + cover territory.
  if not exists (
    select 1 from public.rights_grants g
    where g.id = v_deliv.grant_id and g.title_id = v_deliv.title_id and g.effective_to is null
      and (g.window_start is null or now() >= g.window_start)
      and (g.window_end   is null or now() <= g.window_end)
      and case g.territory_mode
            when 'world'   then true
            when 'include' then v_deliv.territory = any (g.territories)
            when 'exclude' then not (v_deliv.territory = any (g.territories))
          end
  ) then raise exception 'This delivery is no longer covered by an active grant'; end if;

  return query
    select a.storage_key, v_link.id, v_sess.id
    from public.assets a where a.id = v_link.asset_id;
end; $$;
revoke execute on function public.portal_resolve_download(text) from public, anon, authenticated;
grant  execute on function public.portal_resolve_download(text) to service_role;
