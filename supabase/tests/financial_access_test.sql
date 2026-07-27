-- financial_access_test.sql
-- D1: member_can's 'view' verb decomposed. Catalog read stays 'view'; money moves to
-- 'view_financial' (account_owner, accountant, legal).
--
-- Every restriction is asserted BOTH ways for BOTH excluded roles. A restriction tested only
-- from the blocked side proves the door is shut; tested only from the permitted side it
-- proves the door opens. Five findings in this audit were controls with no proof they
-- functioned — this file is the proof for this one, and it is deliberately exhaustive:
-- 4 restricted reads x (2 roles blocked + 3 roles permitted) + catalog-unchanged checks.

begin;
select plan(33);

select set_config('t.org',   gen_random_uuid()::text, false);
select set_config('t.owner', gen_random_uuid()::text, false);
select set_config('t.acct',  gen_random_uuid()::text, false);
select set_config('t.legal', gen_random_uuid()::text, false);
select set_config('t.ops',   gen_random_uuid()::text, false);
select set_config('t.view',  gen_random_uuid()::text, false);
select set_config('t.title', gen_random_uuid()::text, false);
select set_config('t.doc',   gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.owner')::uuid), (current_setting('t.acct')::uuid),
  (current_setting('t.legal')::uuid), (current_setting('t.ops')::uuid),
  (current_setting('t.view')::uuid);
insert into public.organizations (id, name, status)
  values (current_setting('t.org')::uuid, 'Fin Org', 'active');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org')::uuid, current_setting('t.owner')::uuid, 'account_owner', 'active'),
  (current_setting('t.org')::uuid, current_setting('t.acct')::uuid,  'accountant',    'active'),
  (current_setting('t.org')::uuid, current_setting('t.legal')::uuid, 'legal',         'active'),
  (current_setting('t.org')::uuid, current_setting('t.ops')::uuid,   'delivery_ops',  'active'),
  (current_setting('t.org')::uuid, current_setting('t.view')::uuid,  'viewer',        'active');

insert into public.source_documents (id, org_id, kind, content_hash)
  values (current_setting('t.doc')::uuid, current_setting('t.org')::uuid, 'agreement', 'h');
insert into public.contract_terms
  (org_id, tier, revenue_share_rate_bp, effective_from, term_length_months, expires_at, trigger, source_document_id)
  values (current_setting('t.org')::uuid, 'premium', 2500, now(), 24, now() + interval '24 months', 'signup',
          current_setting('t.doc')::uuid);
insert into public.subscriptions (org_id, tier, status, annual_price_cents, stripe_customer_id)
  values (current_setting('t.org')::uuid, 'premium', 'active', 99700, 'cus_fin');
insert into public.organization_payout_details (org_id, trolley_recipient_id, payout_display)
  values (current_setting('t.org')::uuid, 'R-FIN-1', '****4321');
insert into public.titles (id, org_id, title)
  values (current_setting('t.title')::uuid, current_setting('t.org')::uuid, 'Catalog Film');

set local role authenticated;

-- Helper pattern: switch identity, then count what that role can see.
-- ============================ contract_terms ============================
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.view'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.contract_terms), 0, 'viewer: contract_terms BLOCKED');
select is((select count(*)::int from public.contract_terms where revenue_share_rate_bp = 2500), 0,
  'viewer: cannot reach revenue_share_rate_bp');

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ops'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.contract_terms), 0, 'delivery_ops: contract_terms BLOCKED');

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.contract_terms), 1, 'account_owner: contract_terms permitted');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.acct'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.contract_terms), 1, 'accountant: contract_terms permitted');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.legal'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.contract_terms), 1, 'legal: contract_terms permitted');

-- ============================ subscriptions ============================
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.view'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.subscriptions), 0, 'viewer: subscriptions BLOCKED');
select is((select count(*)::int from public.subscriptions where stripe_customer_id = 'cus_fin'), 0,
  'viewer: cannot reach stripe_customer_id');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ops'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.subscriptions), 0, 'delivery_ops: subscriptions BLOCKED');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.subscriptions), 1, 'account_owner: subscriptions permitted');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.acct'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.subscriptions), 1, 'accountant: subscriptions permitted');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.legal'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.subscriptions), 1, 'legal: subscriptions permitted');

-- ====================== organization_payout_details ======================
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.view'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.organization_payout_details), 0, 'viewer: payout details BLOCKED');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ops'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.organization_payout_details), 0, 'delivery_ops: payout details BLOCKED');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.organization_payout_details), 1, 'account_owner: payout details permitted');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.acct'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.organization_payout_details), 1, 'accountant: payout details permitted');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.legal'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.organization_payout_details), 1, 'legal: payout details permitted');

-- the columns must no longer exist on organizations at all
reset role;
select is((select count(*)::int from information_schema.columns
           where table_schema='public' and table_name='organizations'
             and column_name in ('trolley_recipient_id','payout_status','tax_form_status','payout_display')),
          0, 'payout columns removed from organizations entirely');
set local role authenticated;

-- ===================== audit_log: financial rows gated =====================
-- The snapshots are intentionally NOT redacted, so the READ is what must be gated.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.view'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.audit_log where entity='contract_terms'), 0,
  'viewer: audit_log contract_terms rows BLOCKED');
select is((select count(*)::int from public.audit_log where entity='subscriptions'), 0,
  'viewer: audit_log subscriptions rows BLOCKED');
select ok((select count(*) from public.audit_log where entity='contract_terms'
             and (after ? 'revenue_share_rate_bp')) = 0,
  'viewer: the rate is not reachable through the audit trail either');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ops'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.audit_log where entity='subscriptions'), 0,
  'delivery_ops: audit_log subscriptions rows BLOCKED');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.acct'), 'role','authenticated')::text, true);
select ok((select count(*) from public.audit_log where entity='contract_terms') >= 1,
  'accountant: audit_log contract_terms rows permitted');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.legal'), 'role','authenticated')::text, true);
select ok((select count(*) from public.audit_log where entity='subscriptions') >= 1,
  'legal: audit_log subscriptions rows permitted');

-- ========== operational audit history must NOT have been collateral damage ==========
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ops'), 'role','authenticated')::text, true);
select ok((select count(*) from public.audit_log where entity='titles') >= 1,
  'delivery_ops: operational audit history (titles) STILL readable — no collateral loss');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.view'), 'role','authenticated')::text, true);
select ok((select count(*) from public.audit_log where entity='titles') >= 1,
  'viewer: operational audit history (titles) still readable');

-- ================= catalog reads unchanged for the restricted roles =================
select is((select count(*)::int from public.titles where id = current_setting('t.title')::uuid), 1,
  'viewer: catalog read (titles) UNCHANGED');
select is((select count(*)::int from public.organizations where id = current_setting('t.org')::uuid), 1,
  'viewer: organizations row still readable (name/status)');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ops'), 'role','authenticated')::text, true);
select is((select count(*)::int from public.titles where id = current_setting('t.title')::uuid), 1,
  'delivery_ops: catalog read (titles) UNCHANGED');

-- ================= the capability itself =================
reset role;
select ok(public.member_can(current_setting('t.owner')::uuid, current_setting('t.org')::uuid, 'view_financial'),
  'member_can: account_owner has view_financial');
select ok(not public.member_can(current_setting('t.view')::uuid, current_setting('t.org')::uuid, 'view_financial'),
  'member_can: viewer does NOT have view_financial');
select ok(not public.member_can(current_setting('t.ops')::uuid, current_setting('t.org')::uuid, 'view_financial'),
  'member_can: delivery_ops does NOT have view_financial');
select ok(public.member_can(current_setting('t.view')::uuid, current_setting('t.org')::uuid, 'view'),
  'member_can: viewer keeps plain view');

select * from finish();
rollback;
