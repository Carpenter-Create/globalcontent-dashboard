-- ============================================================================
-- 20260721000200_release_dates.sql
--
-- INTENT: Every title gets a real release date (spec: docs/superpowers/specs/
-- 2026-07-21-release-dates-and-dashboard-tiles-design.md). The forward-looking
-- go-to-market date is a distribution decision, and distribution is GC's — so
-- the client only ever enters a historical fact they know, and GC always owns
-- the forward date:
--   - new_release  → client enters no date; GC sets release_date (= original + upcoming).
--   - re_release   → client enters original_release_date (historical); GC sets release_date.
-- Dashboard forward date = release_date (single, always-GC source). Retires the
-- release_year metadata field (moved to first-class columns).
--
-- Ships in dependency order:
--   1. enum (release_type)
--   2. columns on titles + index
--   3. backfill both dates from existing release_year
--   4. write paths: create_title (extended), set_title_release_info (client),
--      set_release_date (GC-only; mirrors set_delivery_status)
--
-- DESTRUCTIVE OPS (per repo destructive-ops rule — approved before apply):
--   - DROP FUNCTION public.create_title(uuid, text)  [replaced by 4-arg version]
--   No table drops; column adds are forward-only + idempotent; backfill fills
--   NULLs only. release_date has NO client write path (GC-only).
-- ============================================================================

-- 1. ENUM --------------------------------------------------------------------
do $$ begin
  create type public.release_type as enum ('new_release','re_release');
exception when duplicate_object then null; end $$;

-- 2. COLUMNS -----------------------------------------------------------------
-- release_type defaults so the existing (already-released) catalog backfills
-- safely; new intake sets it explicitly. Both dates are nullable at the DB level
-- (legacy drafts may lack a year; new releases carry no original) — the
-- re-release rule is enforced in the RPCs, not a CHECK.
alter table public.titles
  add column if not exists release_type          public.release_type not null default 'new_release',
  add column if not exists original_release_date date,   -- client, re-release only (historical)
  add column if not exists release_date          date;   -- GC-only, always (go-to-market)

-- Supports the Dashboard pipeline (upcoming/new filter on the forward date).
create index if not exists titles_release_date_idx on public.titles (org_id, release_date);

-- 3. BACKFILL ----------------------------------------------------------------
-- Existing catalog is already released: seed BOTH dates from the historical
-- release_year (jsonb metadata) as Jan 1. Regex-guarded so a non-4-digit value
-- can't crash make_date. Fills NULLs only.
update public.titles t
   set original_release_date = coalesce(t.original_release_date, make_date((m.data->>'release_year')::int, 1, 1)),
       release_date          = coalesce(t.release_date,          make_date((m.data->>'release_year')::int, 1, 1))
  from public.title_metadata m
 where m.title_id = t.id
   and (m.data ? 'release_year')
   and (m.data->>'release_year') ~ '^\d{4}$'
   and (t.original_release_date is null or t.release_date is null);

-- 4. WRITE PATHS -------------------------------------------------------------

-- 4a. create_title — replace the 2-arg overload with the release-aware one.
--     release_type required; original date required only for a re-release;
--     release_date is never set at intake (GC-owned).
drop function if exists public.create_title(uuid, text);

create or replace function public.create_title(
  p_org_id                uuid,
  p_title                 text,
  p_release_type          public.release_type,
  p_original_release_date date default null
) returns uuid
  language plpgsql security definer set search_path = public
as $$
declare v_title uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'Title is required'; end if;
  if p_release_type is null then raise exception 'Release type is required'; end if;
  if p_release_type = 're_release' and p_original_release_date is null then
    raise exception 'Original release date is required for a re-release';
  end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized to add titles for this organization';
  end if;
  if (select status from public.organizations where id = p_org_id) <> 'active' then
    raise exception 'Your organization must finish onboarding before adding titles';
  end if;

  insert into public.titles (org_id, title, created_by, release_type, original_release_date)
    values (p_org_id, btrim(p_title), auth.uid(), p_release_type,
            case when p_release_type = 're_release' then p_original_release_date else null end)
    returning id into v_title;
  return v_title;
end;
$$;
revoke execute on function public.create_title(uuid, text, public.release_type, date) from public, anon;
grant  execute on function public.create_title(uuid, text, public.release_type, date) to authenticated;

-- 4b. set_title_release_info — client edit of type + original date (operate-gated).
create or replace function public.set_title_release_info(
  p_org_id                uuid,
  p_title_id              uuid,
  p_release_type          public.release_type,
  p_original_release_date date default null
) returns void
  language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_release_type is null then raise exception 'Release type is required'; end if;
  if p_release_type = 're_release' and p_original_release_date is null then
    raise exception 'Original release date is required for a re-release';
  end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized to edit this organization''s titles';
  end if;
  if not exists (select 1 from public.titles t where t.id = p_title_id and t.org_id = p_org_id) then
    raise exception 'Title does not belong to this organization';
  end if;

  update public.titles
     set release_type = p_release_type,
         original_release_date = case when p_release_type = 're_release' then p_original_release_date else null end
   where id = p_title_id;
end;
$$;
revoke execute on function public.set_title_release_info(uuid, uuid, public.release_type, date) from public, anon;
grant  execute on function public.set_title_release_info(uuid, uuid, public.release_type, date) to authenticated;

-- 4c. set_release_date — GC-only go-to-market date (mirrors set_delivery_status).
--     default null clears the date.
create or replace function public.set_release_date(
  p_title_id uuid, p_date date default null
) returns void
  language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  update public.titles set release_date = p_date where id = p_title_id;
  if not found then raise exception 'Title not found'; end if;
end;
$$;
revoke execute on function public.set_release_date(uuid, date) from public, anon;
grant  execute on function public.set_release_date(uuid, date) to authenticated;
