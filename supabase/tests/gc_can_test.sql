-- gc_can_test.sql
-- The GC-side role→capability matrix (20260727000100).
--
-- Before that migration `is_gc_staff` never read `gc_role`, so every GC role held every
-- capability: a gc_viewer could create a delivery, approve chain of title, and mint a
-- master-download URL. This file is the standing proof that gc_role decides.
--
-- THE NEGATIVES ARE THE POINT. An allow-path-only suite passes against the broken code —
-- `gc_account_owner: operate` was true before this migration too. Every role therefore
-- asserts what it CANNOT do, and the headline case is gc_delivery_ops being refused
-- view_financial, which is D1 mirrored onto the GC side.
--
-- Owner role is fine here: gc_can is SECURITY DEFINER and decides from its args.
-- RLS *enforcement* through these capabilities is exercised in rls_tenant_isolation_test.sql.

begin;
-- 32 = owner 7 + accountant 6 + legal 5 + delivery_ops 6 + boundaries 3
--      + member_can delegation 4 + the gc_viewer constraint 1
select plan(32);

select set_config('t.org_a',   gen_random_uuid()::text, false);
select set_config('t.org_b',   gen_random_uuid()::text, false);
select set_config('t.gc_own',  gen_random_uuid()::text, false);
select set_config('t.gc_acct', gen_random_uuid()::text, false);
select set_config('t.gc_legal',gen_random_uuid()::text, false);
select set_config('t.gc_ops',  gen_random_uuid()::text, false);
select set_config('t.nobody',  gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.gc_own')::uuid),   (current_setting('t.gc_acct')::uuid),
  (current_setting('t.gc_legal')::uuid), (current_setting('t.gc_ops')::uuid),
  (current_setting('t.nobody')::uuid);

insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'),
  (current_setting('t.org_b')::uuid, 'Org B');

insert into public.gc_staff (user_id, role) values
  (current_setting('t.gc_own')::uuid,   'gc_account_owner'),
  (current_setting('t.gc_acct')::uuid,  'gc_accountant'),
  (current_setting('t.gc_legal')::uuid, 'gc_legal'),
  (current_setting('t.gc_ops')::uuid,   'gc_delivery_ops');

-- ── gc_account_owner: everything ────────────────────────────────────────────
select ok(    public.gc_can(current_setting('t.gc_own')::uuid, 'view'),               'owner: view');
select ok(    public.gc_can(current_setting('t.gc_own')::uuid, 'view_financial'),     'owner: view_financial');
select ok(    public.gc_can(current_setting('t.gc_own')::uuid, 'operate'),            'owner: operate');
select ok(    public.gc_can(current_setting('t.gc_own')::uuid, 'manage_tax_banking'), 'owner: tax/banking');
select ok(    public.gc_can(current_setting('t.gc_own')::uuid, 'manage_billing'),     'owner: billing');
select ok(    public.gc_can(current_setting('t.gc_own')::uuid, 'manage_team'),        'owner: manage_team');
select ok(    public.gc_can(current_setting('t.gc_own')::uuid, 'manage_settings'),    'owner: manage_settings');

-- ── gc_accountant: read all, writes tax + banking only ──────────────────────
select ok(    public.gc_can(current_setting('t.gc_acct')::uuid, 'view'),               'accountant: view');
select ok(    public.gc_can(current_setting('t.gc_acct')::uuid, 'view_financial'),     'accountant: view_financial');
select ok(    public.gc_can(current_setting('t.gc_acct')::uuid, 'manage_tax_banking'), 'accountant: tax/banking');
select ok(not public.gc_can(current_setting('t.gc_acct')::uuid, 'operate'),            'accountant: NOT operate');
select ok(not public.gc_can(current_setting('t.gc_acct')::uuid, 'manage_billing'),     'accountant: NOT billing');
select ok(not public.gc_can(current_setting('t.gc_acct')::uuid, 'manage_settings'),    'accountant: NOT settings');

-- ── gc_legal: read all, write nothing ───────────────────────────────────────
select ok(    public.gc_can(current_setting('t.gc_legal')::uuid, 'view'),               'legal: view');
select ok(    public.gc_can(current_setting('t.gc_legal')::uuid, 'view_financial'),     'legal: view_financial');
select ok(not public.gc_can(current_setting('t.gc_legal')::uuid, 'operate'),            'legal: NOT operate (writes nothing)');
select ok(not public.gc_can(current_setting('t.gc_legal')::uuid, 'manage_tax_banking'), 'legal: NOT tax/banking');
select ok(not public.gc_can(current_setting('t.gc_legal')::uuid, 'manage_team'),        'legal: NOT manage_team');

-- ── gc_delivery_ops: all operational, no finance, no tax ────────────────────
select ok(    public.gc_can(current_setting('t.gc_ops')::uuid, 'view'),               'delivery_ops: view');
select ok(    public.gc_can(current_setting('t.gc_ops')::uuid, 'operate'),            'delivery_ops: operate');
-- THE HEADLINE. D1 mirrored: "no finance, no tax" is the written rule and now the enforced one.
select ok(not public.gc_can(current_setting('t.gc_ops')::uuid, 'view_financial'),     'delivery_ops: NOT view_financial (D1 mirror)');
select ok(not public.gc_can(current_setting('t.gc_ops')::uuid, 'manage_tax_banking'), 'delivery_ops: NOT tax/banking');
select ok(not public.gc_can(current_setting('t.gc_ops')::uuid, 'manage_billing'),     'delivery_ops: NOT billing');
select ok(not public.gc_can(current_setting('t.gc_ops')::uuid, 'manage_team'),        'delivery_ops: NOT manage_team');

-- ── boundaries ──────────────────────────────────────────────────────────────
select ok(not public.gc_can(null,                              'view'),      'null uid: false');
select ok(not public.gc_can(current_setting('t.nobody')::uuid, 'view'),      'non-staff uid: false');
select ok(not public.gc_can(current_setting('t.gc_own')::uuid, 'teleport'),  'unknown capability: fails CLOSED even for owner');

-- ── member_can must DELEGATE to gc_can, not short-circuit to true ───────────
-- The whole change hangs on this line. If member_can reverts to `then true`, the four
-- assertions above still pass and every policy silently reopens.
select ok(    public.member_can(current_setting('t.gc_ops')::uuid,  current_setting('t.org_b')::uuid, 'view'),
              'member_can: gc_delivery_ops reads ALL orgs (scope still inverts)');
select ok(not public.member_can(current_setting('t.gc_ops')::uuid,  current_setting('t.org_a')::uuid, 'view_financial'),
              'member_can: gc_delivery_ops REFUSED view_financial through member_can');
select ok(not public.member_can(current_setting('t.gc_legal')::uuid, current_setting('t.org_a')::uuid, 'operate'),
              'member_can: gc_legal REFUSED operate through member_can');
select ok(    public.member_can(current_setting('t.gc_own')::uuid,   current_setting('t.org_b')::uuid, 'manage_settings'),
              'member_can: gc_account_owner keeps full reach across orgs');

-- ── gc_viewer is not assignable ─────────────────────────────────────────────
select throws_ok(
  format('insert into public.gc_staff (user_id, role) values (%L, %L)',
         current_setting('t.nobody')::uuid, 'gc_viewer'),
  '23514',
  null,
  'gc_viewer: assignment rejected by gc_staff_role_no_viewer'
);

select * from finish();
rollback;
