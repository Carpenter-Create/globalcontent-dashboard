-- ============================================================================
-- 20260719000200_vendors.sql
--
-- INTENT: GC-administered vendor records (domain-spec §13) — the first NON-tenant
-- table (no org_id): vendors are GC's shared distribution partners, the same list
-- for every client. RLS gates all ops on is_gc_staff. Writes are RLS-gated direct
-- writes (a server action), NOT a SECURITY DEFINER RPC — GC-admin data with no
-- tenant-isolation surface (documented deviation; see known-divergences). No
-- DELETE: `active` toggles (golden rule 2). Portal creds are NEVER stored (§13).
--
-- DELIBERATELY EXCLUDED (seams): deliveries (slice B), client vendor visibility,
-- export mapping consuming export_format_spec (C), email send (D), Glacier (E).
--
-- DESTRUCTIVE OPS (approved before apply): audit + updated_at triggers on vendors.
-- Forward-only + idempotent.
-- ============================================================================

do $$ begin
  create type public.vendor_mode as enum ('portal_upload','email');
exception when duplicate_object then null; end $$;

create table if not exists public.vendors (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  company_info       jsonb,
  delivery_mode      public.vendor_mode not null,
  export_format_spec jsonb,                          -- stored now; consumed by the export slice
  email_to           text[] not null default '{}',
  email_cc           text[] not null default '{}',
  email_template     text,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint vendors_email_recipients_chk check (
    -- cardinality() returns 0 (not NULL) for an empty array, so the CHECK evaluates
    -- to false and actually rejects an email vendor with no recipients. array_length()
    -- would return NULL here, and a CHECK passes on NULL — the rule would be a no-op.
    delivery_mode <> 'email' or cardinality(email_to) >= 1
  )
);
create unique index if not exists vendors_name_unique on public.vendors (lower(name));
create index if not exists vendors_active_idx on public.vendors (active);

-- Provenance: reuse the generic audit trigger. vendors has no org_id, so tg_audit
-- logs the row with org_id = null (a GC-only/system audit row — audit_log's select
-- policy already shows null-org rows to gc_staff only).
drop trigger if exists audit_vendors on public.vendors;
create trigger audit_vendors after insert or update or delete on public.vendors
  for each row execute function public.tg_audit();

drop trigger if exists set_updated_at_vendors on public.vendors;
create trigger set_updated_at_vendors before update on public.vendors
  for each row execute function public.tg_set_updated_at();

alter table public.vendors enable row level security;
revoke all on public.vendors from anon;

-- GC-only, all operations (no org predicate — vendors are global). is_gc_staff is
-- SECURITY DEFINER (reads gc_staff without recursion), so these are non-recursive.
drop policy if exists vendors_select on public.vendors;
create policy vendors_select on public.vendors for select to authenticated
  using (public.is_gc_staff(auth.uid()));
drop policy if exists vendors_insert on public.vendors;
create policy vendors_insert on public.vendors for insert to authenticated
  with check (public.is_gc_staff(auth.uid()));
drop policy if exists vendors_update on public.vendors;
create policy vendors_update on public.vendors for update to authenticated
  using (public.is_gc_staff(auth.uid())) with check (public.is_gc_staff(auth.uid()));
-- No DELETE policy — nothing is deleted (active = false instead).
