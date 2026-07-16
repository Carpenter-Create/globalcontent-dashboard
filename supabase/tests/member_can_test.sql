-- member_can_test.sql
-- The canonical resolver's role→capability matrix + GC staff bypass (domain-spec §4/§22).
-- Owner-role is fine here: member_can() is SECURITY DEFINER and decides purely from its
-- args, not the calling role. (RLS *enforcement* is exercised in rls_tenant_isolation_test.sql.)

begin;
select plan(16);

-- Fixtures (owner role — setup only).
select set_config('t.org_a',   gen_random_uuid()::text, false);
select set_config('t.org_b',   gen_random_uuid()::text, false);
select set_config('t.owner',   gen_random_uuid()::text, false);
select set_config('t.acct',    gen_random_uuid()::text, false);
select set_config('t.legal',   gen_random_uuid()::text, false);
select set_config('t.deliv',   gen_random_uuid()::text, false);
select set_config('t.viewer',  gen_random_uuid()::text, false);
select set_config('t.gc',      gen_random_uuid()::text, false);
select set_config('t.outside', gen_random_uuid()::text, false);

-- auth.users rows (memberships/gc_staff FK to them).
insert into auth.users (id) values
  (current_setting('t.owner')::uuid), (current_setting('t.acct')::uuid),
  (current_setting('t.legal')::uuid), (current_setting('t.deliv')::uuid),
  (current_setting('t.viewer')::uuid), (current_setting('t.gc')::uuid),
  (current_setting('t.outside')::uuid);

insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'),
  (current_setting('t.org_b')::uuid, 'Org B');

insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner')::uuid,  'account_owner', 'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.acct')::uuid,   'accountant',    'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.legal')::uuid,  'legal',         'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.deliv')::uuid,  'delivery_ops',  'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.viewer')::uuid, 'viewer',        'active');

insert into public.gc_staff (user_id, role) values
  (current_setting('t.gc')::uuid, 'gc_delivery_ops');

-- role→capability matrix
select ok(     public.member_can(current_setting('t.owner')::uuid,  current_setting('t.org_a')::uuid, 'view'),               'owner: view');
select ok(     public.member_can(current_setting('t.viewer')::uuid, current_setting('t.org_a')::uuid, 'view'),               'viewer: view');
select ok(not  public.member_can(current_setting('t.viewer')::uuid, current_setting('t.org_a')::uuid, 'operate'),            'viewer: NOT operate');
select ok(     public.member_can(current_setting('t.deliv')::uuid,  current_setting('t.org_a')::uuid, 'operate'),            'delivery_ops: operate');
select ok(not  public.member_can(current_setting('t.deliv')::uuid,  current_setting('t.org_a')::uuid, 'manage_tax_banking'), 'delivery_ops: NOT tax/banking');
select ok(     public.member_can(current_setting('t.acct')::uuid,   current_setting('t.org_a')::uuid, 'manage_tax_banking'), 'accountant: tax/banking');
select ok(not  public.member_can(current_setting('t.acct')::uuid,   current_setting('t.org_a')::uuid, 'operate'),            'accountant: NOT operate');
select ok(     public.member_can(current_setting('t.legal')::uuid,  current_setting('t.org_a')::uuid, 'view'),               'legal: view');
select ok(not  public.member_can(current_setting('t.legal')::uuid,  current_setting('t.org_a')::uuid, 'operate'),            'legal: NOT operate (read-only)');
select ok(     public.member_can(current_setting('t.owner')::uuid,  current_setting('t.org_a')::uuid, 'manage_team'),        'owner: manage_team');
select ok(not  public.member_can(current_setting('t.deliv')::uuid,  current_setting('t.org_a')::uuid, 'manage_team'),        'delivery_ops: NOT manage_team');

-- boundaries
select ok(not  public.member_can(null,                               current_setting('t.org_a')::uuid, 'view'),              'null uid: false');
select ok(not  public.member_can(current_setting('t.owner')::uuid,   current_setting('t.org_b')::uuid, 'view'),              'owner of A: NOT view B');
select ok(not  public.member_can(current_setting('t.outside')::uuid, current_setting('t.org_a')::uuid, 'view'),              'non-member: NOT view');

-- GC staff bypass (scope inverts — all orgs, all capabilities)
select ok(     public.member_can(current_setting('t.gc')::uuid,      current_setting('t.org_a')::uuid, 'manage_settings'),   'gc_staff: bypass A');
select ok(     public.member_can(current_setting('t.gc')::uuid,      current_setting('t.org_b')::uuid, 'view'),              'gc_staff: bypass B (all orgs)');

select * from finish();
rollback;
