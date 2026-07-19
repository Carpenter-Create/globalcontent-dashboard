-- ============================================================================
-- 20260719000500_work_identity.sql
--
-- INTENT: work identity (link same-work titles) + the same-work exclusive-conflict
-- warning primitives (design 2026-07-19-work-identity). works is GC-only; titles
-- gains a nullable work_id (GC-write-only — titles has no client UPDATE policy, so
-- the SECURITY DEFINER link RPC is its sole writer). territories_overlap is the one
-- overlap truth (B-del reuses it). same_work_conflicts / suggest_same_work are
-- SECURITY INVOKER: they run under the caller's RLS, so GC (is_gc_staff bypass)
-- sees all orgs while a client sees only their own (cross-tenant safe, fails closed).
--
-- DESTRUCTIVE OPS (approved before apply): create table, triggers, functions;
-- alter table add column; revokes. Forward-only + idempotent where possible.
-- ============================================================================

-- ---- works (GC-administered grouping of same-work titles) -------------------
create table if not exists public.works (
  id         uuid primary key default gen_random_uuid(),
  label      text,                                   -- optional GC reference name (slice C market-metadata hangs here)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists audit_works on public.works;
create trigger audit_works after insert or update or delete on public.works
  for each row execute function public.tg_audit();
drop trigger if exists set_updated_at_works on public.works;
create trigger set_updated_at_works before update on public.works
  for each row execute function public.tg_set_updated_at();

alter table public.works enable row level security;
revoke all on public.works from anon;
-- RPC-only write path (SECURITY DEFINER runs as owner, unaffected by this revoke).
revoke insert, update, delete on public.works from authenticated, service_role;

drop policy if exists works_select on public.works;
create policy works_select on public.works for select to authenticated
  using (public.is_gc_staff(auth.uid()));
-- No insert/update/delete policies + revoked DML: only the SECURITY DEFINER RPC writes.

-- ---- titles.work_id (nullable; GC-write-only via the RPC) -------------------
alter table public.titles add column if not exists work_id uuid references public.works(id);
create index if not exists titles_work_idx on public.titles (work_id);

-- ---- territories_overlap: the single overlap truth (world/include/exclude) --
create or replace function public.territories_overlap(
  p_mode_a public.territory_mode, p_terr_a text[],
  p_mode_b public.territory_mode, p_terr_b text[]
) returns boolean language sql immutable as $$
  select case
    when p_mode_a = 'world' or p_mode_b = 'world' then true
    when p_mode_a = 'include' and p_mode_b = 'include' then p_terr_a && p_terr_b
    when p_mode_a = 'include' and p_mode_b = 'exclude' then
      exists (select 1 from unnest(p_terr_a) a where a <> all(p_terr_b))
    when p_mode_a = 'exclude' and p_mode_b = 'include' then
      exists (select 1 from unnest(p_terr_b) b where b <> all(p_terr_a))
    when p_mode_a = 'exclude' and p_mode_b = 'exclude' then true
    else false
  end;
$$;

-- ---- link_title_to_work_of: GC assigns a title to the target's work ---------
create or replace function public.link_title_to_work_of(p_title_id uuid, p_target_title_id uuid)
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_work uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  if p_title_id = p_target_title_id then raise exception 'A title cannot be linked to itself'; end if;
  if not exists (select 1 from public.titles where id = p_title_id) then raise exception 'Title not found'; end if;
  select work_id into v_work from public.titles where id = p_target_title_id;
  if not found then raise exception 'Target title not found'; end if;
  if v_work is null then
    insert into public.works (created_by) values (auth.uid()) returning id into v_work;
    update public.titles set work_id = v_work where id = p_target_title_id;
  end if;
  update public.titles set work_id = v_work where id = p_title_id;
  return v_work;
end;
$$;
revoke execute on function public.link_title_to_work_of(uuid, uuid) from public, anon;
grant  execute on function public.link_title_to_work_of(uuid, uuid) to authenticated;

-- ---- same_work_conflicts: the computed warning (SECURITY INVOKER) -----------
-- For a linked title, the active grants on OTHER orgs' titles in the same work
-- that share rights_type, overlap territory, and involve an exclusive claim.
create or replace function public.same_work_conflicts(p_title_id uuid)
  returns table (other_org_name text, other_title text, other_title_id uuid, rights_type public.rights_type)
  language sql stable security invoker set search_path = public as $$
  select distinct o.name, t2.title, t2.id, g1.rights_type
  from public.titles t1
  join public.rights_grants g1 on g1.title_id = t1.id and g1.effective_to is null
  join public.titles t2
    on t2.work_id = t1.work_id and t2.id <> t1.id and t2.org_id <> t1.org_id
  join public.rights_grants g2
    on g2.title_id = t2.id and g2.effective_to is null
   and g2.rights_type = g1.rights_type
   and public.territories_overlap(g1.territory_mode, g1.territories, g2.territory_mode, g2.territories)
   and (g1.exclusive or g2.exclusive)
  join public.organizations o on o.id = t2.org_id
  where t1.id = p_title_id and t1.work_id is not null;
$$;
revoke execute on function public.same_work_conflicts(uuid) from public, anon;
grant  execute on function public.same_work_conflicts(uuid) to authenticated;

-- ---- suggest_same_work: candidate same-work titles (SECURITY INVOKER) -------
-- Other orgs' UNLINKED titles whose normalized name matches and whose release_year
-- agrees (or is unknown on either side). GC-only in practice (RLS scopes it).
create or replace function public.suggest_same_work(p_title_id uuid)
  returns table (title_id uuid, title text, org_name text, release_year text)
  language sql stable security invoker set search_path = public as $$
  with me as (
    select t.id, t.org_id,
           lower(regexp_replace(t.title, '[^a-zA-Z0-9]', '', 'g')) as norm,
           (m.data->>'release_year') as yr
    from public.titles t
    left join public.title_metadata m on m.title_id = t.id
    where t.id = p_title_id
  )
  select t2.id, t2.title, o.name, (m2.data->>'release_year')
  from me
  join public.titles t2
    on t2.id <> me.id and t2.org_id <> me.org_id and t2.work_id is null
   and lower(regexp_replace(t2.title, '[^a-zA-Z0-9]', '', 'g')) = me.norm
  left join public.title_metadata m2 on m2.title_id = t2.id
  join public.organizations o on o.id = t2.org_id
  where me.yr is null or (m2.data->>'release_year') is null or (m2.data->>'release_year') = me.yr
  order by (case when (m2.data->>'release_year') = me.yr then 0 else 1 end), t2.title
  limit 10;
$$;
revoke execute on function public.suggest_same_work(uuid) from public, anon;
grant  execute on function public.suggest_same_work(uuid) to authenticated;
