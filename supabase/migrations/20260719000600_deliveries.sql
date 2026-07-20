-- ============================================================================
-- 20260719000600_deliveries.sql
--
-- INTENT: manual delivery tracking (domain-spec §13; design 2026-07-19-deliveries).
-- A delivery = title × vendor × territory × grant. Written ONLY via GC-only
-- SECURITY DEFINER RPCs (direct writes revoked) that enforce rule 12 and the hard
-- cross-client exclusive-conflict block in-RPC (no trigger — RPC is the sole write
-- path). my_deliveries gives clients their own deliveries + vendor names without
-- loosening vendors' GC-only RLS. Status is person-set; audit_log is the provenance.
--
-- DESTRUCTIVE OPS (approved before apply): create type, table, triggers, functions;
-- revokes. Forward-only + idempotent where possible.
-- ============================================================================

do $$ begin
  create type public.delivery_status as enum ('pending','delivered','live','rejected','taken_down');
exception when duplicate_object then null; end $$;

create table if not exists public.deliveries (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete restrict,
  title_id     uuid not null references public.titles(id)        on delete restrict,
  vendor_id    uuid not null references public.vendors(id)        on delete restrict,
  grant_id     uuid not null references public.rights_grants(id)  on delete restrict,
  territory    text not null,
  status       public.delivery_status not null default 'pending',
  status_note  text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint deliveries_territory_iso_chk check (territory ~ '^[A-Z]{2}$'),
  unique (title_id, vendor_id, territory, grant_id)
);
create index if not exists deliveries_org_idx    on public.deliveries (org_id);
create index if not exists deliveries_title_idx  on public.deliveries (title_id);
create index if not exists deliveries_vendor_idx on public.deliveries (vendor_id);
create index if not exists deliveries_grant_idx  on public.deliveries (grant_id);
create index if not exists deliveries_status_idx on public.deliveries (status);

drop trigger if exists audit_deliveries on public.deliveries;
create trigger audit_deliveries after insert or update or delete on public.deliveries
  for each row execute function public.tg_audit();
drop trigger if exists set_updated_at_deliveries on public.deliveries;
create trigger set_updated_at_deliveries before update on public.deliveries
  for each row execute function public.tg_set_updated_at();

alter table public.deliveries enable row level security;
revoke all on public.deliveries from anon;
revoke insert, update, delete on public.deliveries from authenticated, service_role;  -- RPC-only writes
drop policy if exists deliveries_select on public.deliveries;
create policy deliveries_select on public.deliveries for select to authenticated
  using (public.is_gc_staff(auth.uid()) or public.member_can(auth.uid(), org_id, 'view'));

-- ---- create_delivery: rule-12 + hard conflict block, GC-only -----------------
create or replace function public.create_delivery(
  p_title_id uuid, p_vendor_id uuid, p_grant_id uuid, p_territory text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid;
  v_rt   public.rights_type;
  v_excl boolean;
  v_terr text := upper(btrim(p_territory));
  v_work uuid;
  v_id   uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  if v_terr !~ '^[A-Z]{2}$' then raise exception 'Territory must be an ISO 3166-1 alpha-2 code'; end if;

  select org_id, work_id into v_org, v_work from public.titles where id = p_title_id;
  if not found then raise exception 'Title not found'; end if;
  if not exists (select 1 from public.vendors where id = p_vendor_id and active) then
    raise exception 'Vendor not found or inactive';
  end if;

  -- Rule 12: the SPECIFIC grant must belong to this title, be active, and cover the
  -- rights/territory/window at now(). Captures its rights_type + exclusivity.
  select rights_type, exclusive into v_rt, v_excl
  from public.rights_grants
  where id = p_grant_id and title_id = p_title_id and effective_to is null
    and (window_start is null or now() >= window_start)
    and (window_end   is null or now() <= window_end)
    and case territory_mode
          when 'world'   then true
          when 'include' then v_terr = any (territories)
          when 'exclude' then not (v_terr = any (territories))
        end;
  if not found then
    raise exception 'No active grant on this title covers % (%s)', v_terr, p_grant_id;
  end if;

  -- Hard cross-client conflict block: same work, another org, same rights_type,
  -- overlapping territory, an exclusive claim involved. Runs as owner (sees all orgs).
  if v_work is not null and exists (
    select 1
    from public.titles t2
    join public.rights_grants g2 on g2.title_id = t2.id and g2.effective_to is null
      and g2.rights_type = v_rt
      and public.territories_overlap('include', array[v_terr], g2.territory_mode, g2.territories)
      and (v_excl or g2.exclusive)
    where t2.work_id = v_work and t2.org_id <> v_org
  ) then
    raise exception 'Blocked: another client holds a conflicting exclusive claim on this work for % in %', v_rt, v_terr;
  end if;

  insert into public.deliveries (org_id, title_id, vendor_id, grant_id, territory, created_by)
  values (v_org, p_title_id, p_vendor_id, p_grant_id, v_terr, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.create_delivery(uuid, uuid, uuid, text) from public, anon;
grant  execute on function public.create_delivery(uuid, uuid, uuid, text) to authenticated;

-- ---- set_delivery_status: GC advances status, logged -------------------------
create or replace function public.set_delivery_status(
  p_delivery_id uuid, p_status public.delivery_status, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  update public.deliveries
    set status = p_status, status_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = p_delivery_id;
  if not found then raise exception 'Delivery not found'; end if;
end;
$$;
revoke execute on function public.set_delivery_status(uuid, public.delivery_status, text) from public, anon;
grant  execute on function public.set_delivery_status(uuid, public.delivery_status, text) to authenticated;

-- ---- my_deliveries: client's own deliveries + vendor names -------------------
-- SECURITY DEFINER bypasses vendors' GC-only RLS to read vendor NAME, but the
-- member_can filter (auth.uid() = the caller) scopes rows to the caller's orgs, so
-- no cross-tenant leak. GC callers see all orgs (member_can bypass) — fine.
create or replace function public.my_deliveries()
  returns table (delivery_id uuid, title_id uuid, title text, vendor_name text,
                 territory text, status public.delivery_status, updated_at timestamptz)
  language sql stable security definer set search_path = public as $$
  select d.id, d.title_id, t.title, v.name, d.territory, d.status, d.updated_at
  from public.deliveries d
  join public.titles t  on t.id = d.title_id
  join public.vendors v on v.id = d.vendor_id
  where public.member_can(auth.uid(), d.org_id, 'view')
  order by t.title, v.name, d.territory;
$$;
revoke execute on function public.my_deliveries() from public, anon;
grant  execute on function public.my_deliveries() to authenticated;
