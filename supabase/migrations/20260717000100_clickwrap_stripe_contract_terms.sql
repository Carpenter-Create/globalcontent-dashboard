-- ============================================================================
-- 20260717000100_clickwrap_stripe_contract_terms.sql
--
-- INTENT: The clickwrap + Stripe slice's schema (domain-spec §3/§5/§16/§21):
--   1. org_status: recreate-and-swap to drop contract_review/signed/onboarding and
--      ADD awaiting_payment (the accepted-but-unpaid state). DESTRUCTIVE.
--   2. tier_enum (access|pro|premium), term_trigger_enum.
--   3. contract_terms — the effective-dated, snapshotted rate record (§5).
--   4. contract_assents — the immutable clickwrap assent record (§5).
--   5. subscriptions — Stripe money-in tracking (§16). Access has none (free).
--   6. RPCs: accept_terms (client) writes assent + rendered terms as a source doc
--      (§18); free → writes terms + active; paid → awaiting_payment (terms deferred
--      to payment). finalize_paid_signup (webhook, service_role) writes terms +
--      subscription + active — idempotent.
--
-- PLACEHOLDERS (this slice, test-mode): revenue_share_rate_bp is a PLACEHOLDER —
-- the three real rates are open (§21.5). Agreement TEXT is founder/counsel's, not here.
--
-- DESTRUCTIVE ops (approved before apply, per the repo rule):
--   - org_status recreate-and-swap (rename type, alter column, drop old type)
--   - REVOKE UPDATE/DELETE on contract_assents (immutable legal record)
--   - triggers on the new tables
-- Forward-only + idempotent where possible.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. org_status — recreate-and-swap (DESTRUCTIVE)
--    Existing rows only use 'registered'/'active' (no rows in the dropped values),
--    so the text cast is safe. Guarded so it fails loudly if that ever stops holding.
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from public.organizations
    where status::text in ('contract_review','signed','onboarding')
  ) then
    raise exception 'org_status swap aborted: rows still use a value being dropped';
  end if;
end $$;

alter table public.organizations alter column status drop default;
alter type public.org_status rename to org_status_old;
create type public.org_status as enum
  ('registered','awaiting_payment','active','payment_lapsed','closed');
alter table public.organizations
  alter column status type public.org_status using status::text::public.org_status;
alter table public.organizations alter column status set default 'registered';
drop type public.org_status_old;

-- ----------------------------------------------------------------------------
-- 2. New enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.tier_enum as enum ('access','pro','premium');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.term_trigger_enum as enum
    ('signup','upgrade','downgrade','lapse','renewal','reinstate');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 3. contract_terms — effective-dated, snapshotted rate (§5)
--    NOT fully immutable: effective_to is closed when a new term supersedes (via RPC).
--    No client write path; SELECT for org members.
-- ----------------------------------------------------------------------------
create table if not exists public.contract_terms (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete restrict,
  tier                  public.tier_enum not null,
  revenue_share_rate_bp integer not null,      -- SNAPSHOT (basis points). PLACEHOLDER — §21.5 open.
  effective_from        timestamptz not null,  -- accept/payment event ts, never now() arbitrarily (§5)
  effective_to          timestamptz,           -- null = current
  term_length_months    integer not null,      -- access/pro 12, premium 24 (§5/§21.16)
  expires_at            timestamptz not null,  -- surfaced in the account (§10)
  trigger               public.term_trigger_enum not null,
  source_document_id    uuid references public.source_documents(id),  -- the accepted agreement text
  created_at            timestamptz not null default now()
);
create index if not exists contract_terms_org_idx on public.contract_terms (org_id, effective_from);

-- ----------------------------------------------------------------------------
-- 4. contract_assents — immutable clickwrap assent (§5). Append-only legal record.
-- ----------------------------------------------------------------------------
create table if not exists public.contract_assents (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete restrict,
  user_id            uuid not null references auth.users(id) on delete restrict,
  terms_version      text not null,
  content_hash       text not null,            -- of the RENDERED text (§5)
  source_document_id uuid not null references public.source_documents(id),
  agreed_at          timestamptz not null default now(),
  ip                 inet,
  user_agent         text,
  created_at         timestamptz not null default now()
);
create index if not exists contract_assents_org_idx  on public.contract_assents (org_id);
create index if not exists contract_assents_user_idx on public.contract_assents (user_id);

-- ----------------------------------------------------------------------------
-- 5. subscriptions — Stripe money-in (§16). Paid tiers only.
-- ----------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete restrict,
  tier                   public.tier_enum not null,
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  status                 text not null,          -- stripe sub status (active|past_due|canceled|…)
  annual_price_cents     integer not null,       -- snapshot at purchase (§5 annual_price frozen)
  current_period_end     timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists subscriptions_org_idx on public.subscriptions (org_id);

-- ----------------------------------------------------------------------------
-- 6. Triggers — audit (reuse tg_audit) + updated_at
-- ----------------------------------------------------------------------------
drop trigger if exists audit_contract_terms   on public.contract_terms;
drop trigger if exists audit_contract_assents on public.contract_assents;
drop trigger if exists audit_subscriptions    on public.subscriptions;
create trigger audit_contract_terms   after insert or update or delete on public.contract_terms   for each row execute function public.tg_audit();
create trigger audit_contract_assents after insert or update or delete on public.contract_assents for each row execute function public.tg_audit();
create trigger audit_subscriptions    after insert or update or delete on public.subscriptions    for each row execute function public.tg_audit();

drop trigger if exists set_updated_at_subscriptions on public.subscriptions;
create trigger set_updated_at_subscriptions before update on public.subscriptions for each row execute function public.tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- 7. RLS — SELECT for org members; all writes via the RPCs below (no client writes)
-- ----------------------------------------------------------------------------
alter table public.contract_terms   enable row level security;
alter table public.contract_assents enable row level security;
alter table public.subscriptions    enable row level security;
revoke all on public.contract_terms, public.contract_assents, public.subscriptions from anon;

drop policy if exists contract_terms_select on public.contract_terms;
create policy contract_terms_select on public.contract_terms for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));

drop policy if exists contract_assents_select on public.contract_assents;
create policy contract_assents_select on public.contract_assents for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));

drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));

-- Immutability: assent is an append-only legal record (like audit_log / source layer).
revoke update, delete on public.contract_assents from authenticated, service_role;
-- contract_terms: no UPDATE/DELETE policy for authenticated → only the SECURITY DEFINER
-- RPCs (owner) may write; effective_to supersede happens there, not from the client.

-- ----------------------------------------------------------------------------
-- 8. RPCs
-- ----------------------------------------------------------------------------

-- accept_terms: client-initiated clickwrap accept (runs under the user's JWT).
-- Writes the rendered agreement as a source document + the assent record. Free tier
-- also writes contract_terms and activates; paid tier moves to awaiting_payment
-- (terms are written by finalize_paid_signup after Stripe confirms payment).
create or replace function public.accept_terms(
  p_tier          public.tier_enum,
  p_terms_version text,
  p_content_hash  text,
  p_rendered_text text,
  p_ip            inet,
  p_user_agent    text
) returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_doc uuid;
  v_rate int := 0;   -- PLACEHOLDER revenue share (bp) — real rates open (§21.5)
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  -- Only the account owner may accept/pay (manage_billing capability).
  select m.org_id into v_org
  from public.memberships m
  where m.user_id = v_uid and m.status = 'active' and m.role = 'account_owner'
  limit 1;
  if v_org is null then
    raise exception 'Only the account owner can accept the agreement';
  end if;

  -- Store the EXACT rendered text as an immutable source document (§18/§5).
  insert into public.source_documents (org_id, kind, provided_by, content_hash, raw)
  values (v_org, 'agreement', v_uid, p_content_hash,
          jsonb_build_object('terms_version', p_terms_version, 'tier', p_tier, 'text', p_rendered_text))
  returning id into v_doc;

  -- Record assent at click time (the legal fact).
  insert into public.contract_assents
    (org_id, user_id, terms_version, content_hash, source_document_id, ip, user_agent)
  values (v_org, v_uid, p_terms_version, p_content_hash, v_doc, p_ip, p_user_agent);

  if p_tier = 'access' then
    insert into public.contract_terms
      (org_id, tier, revenue_share_rate_bp, effective_from, term_length_months, expires_at, trigger, source_document_id)
    values (v_org, 'access', v_rate, now(), 12, now() + interval '12 months', 'signup', v_doc);
    update public.organizations set status = 'active' where id = v_org;
    return jsonb_build_object('org_id', v_org, 'source_document_id', v_doc, 'needs_payment', false);
  else
    update public.organizations set status = 'awaiting_payment' where id = v_org;
    return jsonb_build_object('org_id', v_org, 'source_document_id', v_doc, 'needs_payment', true);
  end if;
end $$;
revoke execute on function public.accept_terms(public.tier_enum,text,text,text,inet,text) from public, anon;
grant  execute on function public.accept_terms(public.tier_enum,text,text,text,inet,text) to authenticated;

-- finalize_paid_signup: called by the Stripe webhook handler (service_role) after a
-- verified checkout completion. Writes subscription + contract_terms + activates.
-- Idempotent: safe to replay the webhook (guards on source_document_id + sub id).
create or replace function public.finalize_paid_signup(
  p_org                uuid,
  p_tier               public.tier_enum,
  p_stripe_customer    text,
  p_stripe_subscription text,
  p_price_cents        integer,
  p_effective_from     timestamptz,
  p_source_document_id uuid
) returns void
  language plpgsql security definer set search_path = public
as $$
declare
  v_term_months int := case when p_tier = 'premium' then 24 else 12 end;
  v_rate int := 0;   -- PLACEHOLDER — §21.5
begin
  insert into public.subscriptions
    (org_id, tier, stripe_customer_id, stripe_subscription_id, status, annual_price_cents, current_period_end)
  values (p_org, p_tier, p_stripe_customer, p_stripe_subscription, 'active', p_price_cents,
          p_effective_from + interval '1 year')
  on conflict (stripe_subscription_id) do nothing;

  -- Idempotency: one term per accepted agreement (source document).
  if not exists (
    select 1 from public.contract_terms where source_document_id = p_source_document_id
  ) then
    insert into public.contract_terms
      (org_id, tier, revenue_share_rate_bp, effective_from, term_length_months, expires_at, trigger, source_document_id)
    values (p_org, p_tier, v_rate, p_effective_from, v_term_months,
            p_effective_from + (v_term_months || ' months')::interval, 'signup', p_source_document_id);
  end if;

  update public.organizations set status = 'active'
  where id = p_org and status = 'awaiting_payment';
end $$;
revoke execute on function public.finalize_paid_signup(uuid,public.tier_enum,text,text,integer,timestamptz,uuid) from public, anon, authenticated;
grant  execute on function public.finalize_paid_signup(uuid,public.tier_enum,text,text,integer,timestamptz,uuid) to service_role;
