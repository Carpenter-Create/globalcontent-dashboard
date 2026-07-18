-- ============================================================================
-- 20260718000100_titles.sql
--
-- INTENT: The title stub — the first product-domain table on top of the proven
-- org/RLS/provenance spine (CLAUDE.md build order: title stub → rights grant →
-- asset upload; domain-spec §11–12). Deliberately minimal per §12: "create the
-- title stub → start the asset upload → let the client fill metadata." The stub
-- is just the stable anchor row that assets, metadata, rights grants, and
-- deliveries attach to by FK in later slices.
--
-- Ships complete, in dependency order (mirrors the init migration):
--   1. enum (title_status — the full §11 lifecycle)
--   2. table (titles) + indexes
--   3. triggers (audit + updated_at — reuse the existing generic functions)
--   4. RLS enabled, SELECT policy routed through member_can()
--   5. one mutation-as-RPC (create_title) — the write path, capability-gated
--
-- DELIBERATELY EXCLUDED (later slices, per domain-spec §23):
--   metadata fields (guided-form intake — "not inventable", from vendor reqs),
--   submit/status transitions + in_review gate, rights grants, assets, delivery,
--   edit/takedown. Full status enum is created now so those transitions don't
--   require an enum swap. Only 'draft' is reachable this slice.
--
-- SCOPE: only 'draft' is written this slice (create_title). Status transitions
-- and their UPDATE policy land with the submit/takedown slice that needs them.
--
-- DESTRUCTIVE OPS in this file (per repo destructive-ops rule — approved before apply):
--   - trigger creation on the titles table (audit + updated_at)
--   No REVOKE on existing objects; no table drops/alters. Forward-only + idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUM
-- ----------------------------------------------------------------------------
-- The full §11 title lifecycle, created up front (spec-locked) so later
-- transitions never need an enum swap. Only 'draft' is reachable this slice.

do $$ begin
  create type public.title_status as enum
    ('draft','submitted','in_review','in_delivery','live','takedown_requested','taken_down');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. TABLE
-- ----------------------------------------------------------------------------
-- titles — the flat catalog (§11, no hierarchy). Org-owned, never user-owned:
-- FK to organizations is ON DELETE RESTRICT so a departing employee never
-- cascades a client's catalog (§11 deletion rule). created_by mirrors
-- source_documents.provided_by (who entered it) and is set-null on user deletion.
create table if not exists public.titles (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete restrict,
  title      text not null,
  status     public.title_status not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists titles_org_idx    on public.titles (org_id);
create index if not exists titles_status_idx  on public.titles (org_id, status);

-- ----------------------------------------------------------------------------
-- 3. TRIGGERS — provenance/audit + updated_at (reuse the generic functions)
-- ----------------------------------------------------------------------------
-- tg_audit() is generic: it reads org_id off the row, so titles is audited with
-- no new function. For a manual stub the audit_log row IS the provenance record
-- (golden rule 5) — no source_documents row for a bare stub.
drop trigger if exists audit_titles on public.titles;
create trigger audit_titles after insert or update or delete on public.titles
  for each row execute function public.tg_audit();

drop trigger if exists set_updated_at_titles on public.titles;
create trigger set_updated_at_titles before update on public.titles
  for each row execute function public.tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. RLS — enabled; SELECT routed through member_can(); no anon surface
-- ----------------------------------------------------------------------------
alter table public.titles enable row level security;
revoke all on public.titles from anon;

-- Read by any org member (or GC staff, all orgs — via member_can/is_gc_staff).
drop policy if exists titles_select on public.titles;
create policy titles_select on public.titles for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));

-- INSERT: only via create_title() RPC (SECURITY DEFINER). No client insert path,
--         mirroring organizations. UPDATE/DELETE: none this slice
--         (nothing is ever deleted — golden rule 2; transitions come later).

-- ----------------------------------------------------------------------------
-- 5. WRITE-PATH RPC — create the title stub (mutation-as-RPC, capability-gated)
-- ----------------------------------------------------------------------------
-- Mirrors create_org_and_membership. Re-checks member_can(...,'operate') inside
-- the definer function (defense in depth: RLS + explicit capability check).
-- 'operate' = account_owner or delivery_ops (§4) — the roles that submit titles.
create or replace function public.create_title(p_org_id uuid, p_title text)
  returns uuid
  language plpgsql security definer set search_path = public
as $$
declare v_title uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'Title is required';
  end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized to add titles for this organization';
  end if;

  insert into public.titles (org_id, title, created_by)
    values (p_org_id, btrim(p_title), auth.uid())
    returning id into v_title;
  return v_title;
end;
$$;

revoke execute on function public.create_title(uuid, text) from public, anon;
grant  execute on function public.create_title(uuid, text) to authenticated;
