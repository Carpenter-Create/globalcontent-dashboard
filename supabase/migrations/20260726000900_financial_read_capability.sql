-- ============================================================================
-- 20260726000900_financial_read_capability.sql
--
-- INTENT: resolve D1. member_can's single 'view' verb admits ALL FIVE org roles, so
-- `viewer` and `delivery_ops` can read subscriptions, contract_terms.revenue_share_rate_bp,
-- and the organizations payout columns. CLAUDE.md scopes `viewer` to "catalog read-only"
-- and `delivery_ops` to "all operational incl. rights + territories; no finance, no tax".
-- Both are spec deviations. Reproduced live in every audit pass as B3 cases E9/E10/E11.
--
-- BLAST RADIUS, enumerated before writing a line (21 of 34 policies route through
-- member_can; 16 of those use 'view'):
--   changed  : contract_terms_select, subscriptions_select, audit_log_select  (3 of 16)
--   unchanged: assets, contract_assents, deliveries, findings, memberships, notifications,
--              organizations, rights_grants, source_documents, source_records,
--              title_metadata, title_reviews, titles                          (13 of 16)
--   unchanged: the 5 'operate' / 'manage_team' / 'manage_settings' policies
--   unchanged: all 13 functions calling member_can — 8 use 'operate', 5 use 'view' and are
--              notifications/findings/deliveries reads. None touches financial data.
--   unchanged: the application. Zero TypeScript call sites; member_can is reached only
--              through RLS and RPCs.
--
-- WHO GETS view_financial: account_owner, accountant, legal.
--   accountant  — "read all; writes tax + banking only"
--   legal       — "read all, write nothing"
--   delivery_ops— EXCLUDED. "no finance, no tax" is unambiguous.
--   viewer      — EXCLUDED. "catalog read-only".
-- GC staff are unaffected: member_can short-circuits on is_gc_staff before any capability
-- is evaluated.
--
-- WHY organizations NEEDS A TABLE, NOT A POLICY. `viewer` legitimately reads
-- organizations.id/name/status (org switcher, status banner) but must not read the four
-- payout columns. RLS is row-level; it cannot mask a column. And a column-level GRANT
-- cannot help either, because privileges attach to the DATABASE ROLE and every client user
-- — owner, accountant, viewer alike — is `authenticated`. The only mechanism that separates
-- them per-row-per-role is RLS on a separate relation. So the payout columns move.
--
-- That is nearly free right now and will never be cheaper: nothing in the application reads
-- these columns (verified by grep — only the generated types mention them), and all 66 orgs
-- have all four NULL, so the data migration moves zero values.
--
-- AUDIT_LOG, and a deliberate departure worth reading. The brief said "separate capability,
-- gated to the same three roles". A blanket restriction of audit_log to those three would
-- also take operational history away from delivery_ops, who has a legitimate need for it and
-- no financial exposure through it. Only three entities' snapshots contain financial keys —
-- verified against the live table, not assumed:
--     contract_terms  revenue_share_rate_bp, tier
--     subscriptions   annual_price_cents, stripe_customer_id, stripe_subscription_id, tier
--     organizations   payout_display, payout_status, tax_form_status, trolley_recipient_id
-- So the policy gates BY ENTITY: financial entities need view_financial, everything else
-- keeps 'view'. Same three roles for the financial rows, no collateral loss. To make it a
-- blanket restriction instead, replace the CASE with member_can(..., 'view_financial').
--
-- Snapshots are NOT redacted at write time, per the brief: proving what the rate was and
-- when it changed is the point of the record.
--
-- STILL OPEN, found while checking and deliberately NOT changed here: source_documents.raw
-- stores {terms_version, tier, text} for the accepted agreement, and source_documents_select
-- uses 'view' — so `viewer` can read the org's TIER from the agreement record. The current
-- placeholder text contains no pricing (checked), but renderAgreement() interpolates
-- TIER_META once counsel's text lands. Not folded in because source_documents is the
-- immutable legal record and `legal` must keep reading it; narrowing it is a separate call.
--
-- DESTRUCTIVE OPS: creates a table; moves 0 rows; DROPS four all-NULL columns from
-- public.organizations; replaces three policies and member_can. Requires TS type
-- regeneration. Forward-only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. member_can gains view_financial. Every other capability is byte-identical.
-- ----------------------------------------------------------------------------
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
          -- Catalog read is 'view'. MONEY is view_financial: subscriptions, contract terms
          -- and rate, payout identifiers, and the audit rows carrying them. delivery_ops is
          -- excluded ("no finance, no tax"); viewer is excluded ("catalog read-only").
          when 'view_financial'     then m.role in ('account_owner','accountant','legal')
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
-- 2. contract_terms + subscriptions: repoint from 'view' to 'view_financial'.
-- ----------------------------------------------------------------------------
drop policy if exists contract_terms_select on public.contract_terms;
create policy contract_terms_select on public.contract_terms for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view_financial'));

drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view_financial'));

-- ----------------------------------------------------------------------------
-- 3. organizations payout columns -> their own relation, gated by view_financial.
-- ----------------------------------------------------------------------------
create table if not exists public.organization_payout_details (
  org_id               uuid primary key references public.organizations(id) on delete restrict,
  -- GC never holds banking or tax identifiers (rule 13). Opaque Trolley id, status flags,
  -- and a masked display string only — same shape as before, just separately readable.
  trolley_recipient_id text,
  payout_status        text,
  tax_form_status      text,
  payout_display       text,                              -- e.g. '••••4321'
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Move whatever exists. Today that is zero values across 66 orgs; the insert is written to
-- be correct rather than to assume that.
insert into public.organization_payout_details
  (org_id, trolley_recipient_id, payout_status, tax_form_status, payout_display)
select id, trolley_recipient_id, payout_status, tax_form_status, payout_display
from public.organizations
where trolley_recipient_id is not null or payout_status is not null
   or tax_form_status is not null or payout_display is not null
on conflict (org_id) do nothing;

alter table public.organizations
  drop column if exists trolley_recipient_id,
  drop column if exists payout_status,
  drop column if exists tax_form_status,
  drop column if exists payout_display;

alter table public.organization_payout_details enable row level security;

drop policy if exists organization_payout_details_select on public.organization_payout_details;
create policy organization_payout_details_select on public.organization_payout_details
  for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view_financial'));
-- No INSERT/UPDATE policy: writes arrive from the Trolley flow via a SECURITY DEFINER RPC
-- when that is built (manage_tax_banking = account_owner + accountant). No DELETE, ever.

drop trigger if exists audit_organization_payout_details on public.organization_payout_details;
create trigger audit_organization_payout_details
  after insert or update or delete on public.organization_payout_details
  for each row execute function public.tg_audit();
drop trigger if exists set_updated_at_organization_payout_details on public.organization_payout_details;
create trigger set_updated_at_organization_payout_details
  before update on public.organization_payout_details
  for each row execute function public.tg_set_updated_at();

-- EXPLICIT GRANTS. A new table inherits nothing dependable from pg_default_acl — that is
-- the whole lesson of 20260726000600. State them.
revoke all on public.organization_payout_details from anon;
grant select on public.organization_payout_details to authenticated;
grant select, insert, update on public.organization_payout_details to service_role;

-- ----------------------------------------------------------------------------
-- 4. audit_log: gate the financial entities, keep operational history readable.
-- ----------------------------------------------------------------------------
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (
    public.is_gc_staff(auth.uid())
    or (
      org_id is not null
      and case
        when entity in ('contract_terms','subscriptions','organizations','organization_payout_details')
          then public.member_can(auth.uid(), org_id, 'view_financial')
        else public.member_can(auth.uid(), org_id, 'view')
      end
    )
  );

-- ----------------------------------------------------------------------------
-- 5. Prove it at apply time rather than trusting the statements above.
-- ----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='organizations'
               and column_name in ('trolley_recipient_id','payout_status','tax_form_status','payout_display'))
  then raise exception 'payout columns still present on organizations'; end if;

  select string_agg(tablename||'.'||policyname, ', ') into v_bad
  from pg_policies
  where schemaname='public' and tablename in ('contract_terms','subscriptions')
    and cmd='SELECT' and qual not like '%view_financial%';
  if v_bad is not null then raise exception 'financial policies not repointed: %', v_bad; end if;

  if not public.member_can(null, null, 'view_financial') is not null then null; end if;
  raise notice 'view_financial in place; payout columns relocated; audit_log gated by entity';
end $$;
