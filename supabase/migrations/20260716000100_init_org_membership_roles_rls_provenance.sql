-- ============================================================================
-- 20260716000100_init_org_membership_roles_rls_provenance.sql
--
-- INTENT: The first vertical slice's foundation — multi-tenant, role-aware RLS
-- proven end-to-end, plus the provenance spine, in the FIRST migration (per
-- CLAUDE.md build order and golden rules 1/4/5, and docs/domain-spec.md §18).
--
-- Ships complete, in dependency order:
--   1. enums (org_role, gc_role, org_status, membership_status)
--   2. tables (organizations, memberships, gc_staff, source_documents,
--      source_records, audit_log) — each with indexes
--   3. authorization: is_gc_staff() + the single canonical member_can() resolver
--   4. provenance/audit triggers + updated_at trigger
--   5. RLS enabled on every table, policies routed through member_can()
--   6. immutability: UPDATE/DELETE revoked on audit_log + source layer
--   7. one mutation-as-RPC (create_org_and_membership) to prove the write path
--
-- DELIBERATELY EXCLUDED (later slices / seams, per domain-spec §23):
--   contracts/e-sign, Stripe, Trolley writes, titles, rights grants, assets,
--   delivery, findings, notifications, the AI `agent` role + proposals wall,
--   user_profiles (auth.users suffices to prove RLS here), invitations.
--
-- IDENTITY: Supabase-native. Policies read auth.uid()/auth.role() directly —
-- no identity shim (that was an Aurora-port concern; see docs/db-platform-decision.md).
--
-- DESTRUCTIVE OPS in this file (per repo destructive-ops rule — approved before apply):
--   - trigger creation on business tables
--   - REVOKE UPDATE/DELETE on audit_log, source_documents, source_records
-- Forward-only + idempotent: re-running converges.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUMS
-- ----------------------------------------------------------------------------
-- Client org roles (domain-spec §4). GC-side roles are a DISTINCT enum with a
-- `gc_` prefix (§22) so a gc_* value can never be stored in an org_role column —
-- the name-collision surface is closed by the type system, not by policy vigilance.

do $$ begin
  create type public.org_role as enum
    ('account_owner','accountant','legal','delivery_ops','viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.gc_role as enum
    ('gc_account_owner','gc_accountant','gc_legal','gc_delivery_ops','gc_viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.org_status as enum
    ('registered','contract_review','signed','onboarding','active','payment_lapsed','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.membership_status as enum ('invited','active','removed');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. TABLES
-- ----------------------------------------------------------------------------

-- organizations — the client org. All business data is org-owned (§3).
create table if not exists public.organizations (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  status               public.org_status not null default 'registered',
  dunning_hold         boolean not null default false,   -- §8: pause auto-drop for a large client
  -- Trolley: GC never holds banking/tax identifiers (§16) — masked display only.
  trolley_recipient_id text,
  payout_status        text,
  tax_form_status      text,
  payout_display       text,                              -- e.g. '••••4321'
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- memberships — user↔org+role. A user leaving is a status change, never a delete
-- (golden rule 2). FK to auth.users is ON DELETE RESTRICT: user deletion is a
-- deliberate PII flow (§11) that must handle memberships explicitly, never cascade.
create table if not exists public.memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete restrict,
  user_id    uuid not null references auth.users(id) on delete restrict,
  role       public.org_role not null,
  status     public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists memberships_org_idx  on public.memberships (org_id);

-- gc_staff — the home for GC-side roles (§22 decision). Separate relation so gc_*
-- roles physically cannot appear in client memberships. Provisioned out-of-band by
-- an admin/service-role, like the (later) agent role — no client write path.
create table if not exists public.gc_staff (
  user_id    uuid primary key references auth.users(id) on delete restrict,
  role       public.gc_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- source_documents — immutable, write-once (§18, golden rule 3). Store the file as
-- received: hash, who, when. S3 key not URL (golden rule 14). Corrections = new rows.
create table if not exists public.source_documents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete restrict,
  kind         text not null,
  received_at  timestamptz not null default now(),
  provided_by  uuid references auth.users(id) on delete set null,
  content_hash text not null,
  storage_key  text,        -- S3 key / storage pointer; never a URL
  raw          jsonb,        -- inline for small text; else via storage_key
  created_at   timestamptz not null default now()
);
create index if not exists source_documents_org_idx on public.source_documents (org_id);

-- source_records — parsed rows from a document. Immutable. org_id denormalized for
-- RLS tenant scoping; safe because the table is write-once (set-once, cannot drift).
create table if not exists public.source_records (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.source_documents(id) on delete restrict,
  org_id      uuid not null references public.organizations(id) on delete restrict,
  line_no     integer,
  parsed      jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists source_records_document_idx on public.source_records (document_id);
create index if not exists source_records_org_idx      on public.source_records (org_id);

-- audit_log — append-only (§18, golden rule 5). Trigger-populated; UPDATE/DELETE
-- revoked below. org_id nullable: system-level events (org_id null) are GC-only.
create table if not exists public.audit_log (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid,
  entity    text not null,
  entity_id uuid,
  action    text not null,       -- 'insert'|'update'|'delete'|domain actions later
  actor     uuid,                -- auth.uid() of the actor; null for system
  at        timestamptz not null default now(),
  before    jsonb,
  after     jsonb
);
create index if not exists audit_log_org_idx    on public.audit_log (org_id);
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id);
create index if not exists audit_log_at_idx      on public.audit_log (at);

-- ----------------------------------------------------------------------------
-- 3. AUTHORIZATION — is_gc_staff() + the single canonical member_can() resolver
-- ----------------------------------------------------------------------------

-- is_gc_staff: the GC staff-bypass primitive. SECURITY DEFINER so it reads gc_staff
-- WITHOUT triggering gc_staff's own RLS (prevents recursive-policy infinite loops).
create or replace function public.is_gc_staff(p_uid uuid)
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.gc_staff where user_id = p_uid);
$$;

-- member_can: THE canonical resolver. Every policy routes through this (rls-data-layer §2).
-- GC staff span all orgs (bypass); otherwise an active client membership is mapped
-- role→capability per domain-spec §4.
create or replace function public.member_can(p_uid uuid, p_org uuid, p_capability text)
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select case
    when p_uid is null then false
    when public.is_gc_staff(p_uid) then true            -- GC scope inverts: all orgs
    else exists (
      select 1 from public.memberships m
      where m.user_id = p_uid
        and m.org_id  = p_org
        and m.status  = 'active'
        and case p_capability
          when 'view'               then m.role in ('account_owner','accountant','legal','delivery_ops','viewer')
          when 'operate'            then m.role in ('account_owner','delivery_ops')  -- titles/assets/rights/delivery
          when 'manage_tax_banking' then m.role in ('account_owner','accountant')    -- Trolley widget (§16)
          when 'manage_billing'     then m.role =  'account_owner'                    -- Stripe subscription/tier
          when 'manage_team'        then m.role =  'account_owner'
          when 'manage_settings'    then m.role =  'account_owner'
          else false
        end
    )
  end;
$$;

-- ----------------------------------------------------------------------------
-- 4. TRIGGERS — provenance/audit + updated_at
-- ----------------------------------------------------------------------------

-- tg_audit: append a before→after row to audit_log for every business-table change.
-- SECURITY DEFINER so it can INSERT into audit_log regardless of the actor's RLS.
create or replace function public.tg_audit()
  returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_before jsonb;
  v_after  jsonb;
  v_org    uuid;
begin
  if    tg_op = 'INSERT' then v_after := to_jsonb(new); v_before := null;
  elsif tg_op = 'UPDATE' then v_after := to_jsonb(new); v_before := to_jsonb(old);
  elsif tg_op = 'DELETE' then v_before := to_jsonb(old); v_after := null;
  end if;

  -- organizations carry their org identity as `id`; everything else as `org_id`.
  if tg_table_name = 'organizations' then
    v_org := coalesce((v_after->>'id')::uuid, (v_before->>'id')::uuid);
  else
    v_org := coalesce((v_after->>'org_id')::uuid, (v_before->>'org_id')::uuid);
  end if;

  insert into public.audit_log (org_id, entity, entity_id, action, actor, before, after)
  values (
    v_org, tg_table_name,
    coalesce((v_after->>'id')::uuid, (v_before->>'id')::uuid),
    lower(tg_op), v_actor, v_before, v_after
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_organizations    on public.organizations;
drop trigger if exists audit_memberships       on public.memberships;
drop trigger if exists audit_gc_staff          on public.gc_staff;
drop trigger if exists audit_source_documents  on public.source_documents;
drop trigger if exists audit_source_records    on public.source_records;

create trigger audit_organizations   after insert or update or delete on public.organizations   for each row execute function public.tg_audit();
create trigger audit_memberships      after insert or update or delete on public.memberships      for each row execute function public.tg_audit();
create trigger audit_gc_staff         after insert or update or delete on public.gc_staff         for each row execute function public.tg_audit();
create trigger audit_source_documents after insert or update or delete on public.source_documents for each row execute function public.tg_audit();
create trigger audit_source_records   after insert or update or delete on public.source_records   for each row execute function public.tg_audit();

-- updated_at maintenance
create or replace function public.tg_set_updated_at()
  returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists set_updated_at_organizations on public.organizations;
drop trigger if exists set_updated_at_memberships    on public.memberships;
drop trigger if exists set_updated_at_gc_staff       on public.gc_staff;

create trigger set_updated_at_organizations before update on public.organizations for each row execute function public.tg_set_updated_at();
create trigger set_updated_at_memberships    before update on public.memberships    for each row execute function public.tg_set_updated_at();
create trigger set_updated_at_gc_staff       before update on public.gc_staff       for each row execute function public.tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. RLS — enabled on every table; policies route through member_can()
-- ----------------------------------------------------------------------------
alter table public.organizations    enable row level security;
alter table public.memberships       enable row level security;
alter table public.gc_staff          enable row level security;
alter table public.source_documents  enable row level security;
alter table public.source_records    enable row level security;
alter table public.audit_log         enable row level security;

-- No anon surface in this slice: strip anon access on every table.
revoke all on public.organizations, public.memberships, public.gc_staff,
              public.source_documents, public.source_records, public.audit_log
  from anon;

-- organizations
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations for select to authenticated
  using (public.member_can(auth.uid(), id, 'view'));
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations for update to authenticated
  using (public.member_can(auth.uid(), id, 'manage_settings'))
  with check (public.member_can(auth.uid(), id, 'manage_settings'));
-- INSERT: only via create_org_and_membership() RPC (SECURITY DEFINER). No client insert.
-- DELETE: none — nothing is ever deleted (golden rule 2).

-- memberships
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));
drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.member_can(auth.uid(), org_id, 'manage_team'));
drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships for update to authenticated
  using (public.member_can(auth.uid(), org_id, 'manage_team'))
  with check (public.member_can(auth.uid(), org_id, 'manage_team'));
-- DELETE: none — removal is status = 'removed'.

-- gc_staff — visible only to GC staff (non-recursive via is_gc_staff definer helper).
-- No client/authenticated write path; provisioned by service-role/admin.
drop policy if exists gc_staff_select on public.gc_staff;
create policy gc_staff_select on public.gc_staff for select to authenticated
  using (public.is_gc_staff(auth.uid()));

-- source_documents — read by org members; insert by operate-capable; immutable after.
drop policy if exists source_documents_select on public.source_documents;
create policy source_documents_select on public.source_documents for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));
drop policy if exists source_documents_insert on public.source_documents;
create policy source_documents_insert on public.source_documents for insert to authenticated
  with check (public.member_can(auth.uid(), org_id, 'operate'));
-- UPDATE/DELETE: none + revoked below (immutable).

-- source_records
drop policy if exists source_records_select on public.source_records;
create policy source_records_select on public.source_records for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));
drop policy if exists source_records_insert on public.source_records;
create policy source_records_insert on public.source_records for insert to authenticated
  with check (public.member_can(auth.uid(), org_id, 'operate'));
-- UPDATE/DELETE: none + revoked below (immutable).

-- audit_log — read by org members (org-scoped) or any GC staff (incl. system events).
-- INSERT only via the SECURITY DEFINER trigger; UPDATE/DELETE revoked (append-only).
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (
    public.is_gc_staff(auth.uid())
    or (org_id is not null and public.member_can(auth.uid(), org_id, 'view'))
  );

-- ----------------------------------------------------------------------------
-- 6. IMMUTABILITY — append-only audit_log; write-once source layer
--    (DESTRUCTIVE: revokes below shown for approval per the destructive-ops rule)
-- ----------------------------------------------------------------------------
revoke update, delete on public.audit_log        from authenticated, service_role;
revoke update, delete on public.source_documents from authenticated, service_role;
revoke update, delete on public.source_records   from authenticated, service_role;
-- Note: the table owner (postgres) retains full rights and is the audited break-glass
-- path; RLS + these revokes stop authenticated and service_role from tampering.

-- ----------------------------------------------------------------------------
-- 7. WRITE-PATH RPC — create the org + owner membership atomically (proves the
--    mutation-as-RPC pattern; this is signup's org-creation step).
-- ----------------------------------------------------------------------------
create or replace function public.create_org_and_membership(p_name text)
  returns uuid
  language plpgsql security definer set search_path = public
as $$
declare v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Organization name is required';
  end if;

  insert into public.organizations (name) values (btrim(p_name)) returning id into v_org;
  insert into public.memberships (org_id, user_id, role, status)
    values (v_org, auth.uid(), 'account_owner', 'active');
  return v_org;
end;
$$;

revoke execute on function public.create_org_and_membership(text) from public, anon;
grant  execute on function public.create_org_and_membership(text) to authenticated;
