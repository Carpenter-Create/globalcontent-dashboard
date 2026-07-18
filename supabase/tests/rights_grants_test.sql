-- rights_grants_test.sql
-- Rights grants: tenant isolation, add_rights_grant capability matrix,
-- immutability (the expand-never-contract guarantee), union semantics, and the
-- can_deliver gate matrix (rule 12).

begin;
select plan(16);

select set_config('t.org_a',  gen_random_uuid()::text, false);
select set_config('t.org_b',  gen_random_uuid()::text, false);
select set_config('t.owner',  gen_random_uuid()::text, false);  -- account_owner, A
select set_config('t.deliv',  gen_random_uuid()::text, false);  -- delivery_ops,  A
select set_config('t.viewer', gen_random_uuid()::text, false);  -- viewer,        A
select set_config('t.legal',  gen_random_uuid()::text, false);  -- legal,         A
select set_config('t.gc',     gen_random_uuid()::text, false);  -- GC staff
select set_config('t.title_a',gen_random_uuid()::text, false);
select set_config('t.title_b',gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.owner')::uuid), (current_setting('t.deliv')::uuid),
  (current_setting('t.viewer')::uuid), (current_setting('t.legal')::uuid),
  (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'), (current_setting('t.org_b')::uuid, 'Org B');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner')::uuid,  'account_owner', 'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.deliv')::uuid,  'delivery_ops',  'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.viewer')::uuid, 'viewer',        'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.legal')::uuid,  'legal',         'active');
insert into public.gc_staff (user_id, role) values
  (current_setting('t.gc')::uuid, 'gc_delivery_ops');
insert into public.titles (id, org_id, title) values
  (current_setting('t.title_a')::uuid, current_setting('t.org_a')::uuid, 'Title A'),
  (current_setting('t.title_b')::uuid, current_setting('t.org_b')::uuid, 'Title B');

-- Direct fixture grant (owner-role setup): AVOD, include US, no window.
insert into public.rights_grants
  (org_id, title_id, rights_type, territory_mode, territories, effective_from)
values
  (current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
   'avod', 'include', array['US'], now());

-- can_deliver matrix (owner-role; SECURITY DEFINER decides from args)
select ok(     public.can_deliver(current_setting('t.title_a')::uuid, 'avod', 'US', now()),
  'can_deliver: AVOD US inside include grant');
select ok(not  public.can_deliver(current_setting('t.title_a')::uuid, 'avod', 'CA', now()),
  'can_deliver: AVOD CA NOT covered (not in include list)');
select ok(not  public.can_deliver(current_setting('t.title_a')::uuid, 'svod', 'US', now()),
  'can_deliver: wrong rights_type NOT covered');

-- window boundary
insert into public.rights_grants
  (org_id, title_id, rights_type, territory_mode, territories, window_start, window_end, effective_from)
values
  (current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
   'svod', 'world', '{}', now() + interval '10 days', now() + interval '20 days', now());
select ok(not  public.can_deliver(current_setting('t.title_a')::uuid, 'svod', 'FR', now()),
  'can_deliver: before window = false');
select ok(     public.can_deliver(current_setting('t.title_a')::uuid, 'svod', 'FR', now() + interval '15 days'),
  'can_deliver: inside window + world = true');

-- exclude mode
insert into public.rights_grants
  (org_id, title_id, rights_type, territory_mode, territories, effective_from)
values
  (current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
   'tvod', 'exclude', array['GB'], now());
select ok(     public.can_deliver(current_setting('t.title_a')::uuid, 'tvod', 'US', now()),
  'can_deliver: exclude GB covers US');
select ok(not  public.can_deliver(current_setting('t.title_a')::uuid, 'tvod', 'GB', now()),
  'can_deliver: exclude GB does NOT cover GB');

-- expired grant excluded
insert into public.rights_grants
  (org_id, title_id, rights_type, territory_mode, territories, effective_from, effective_to)
values
  (current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
   'est', 'world', '{}', now() - interval '2 days', now() - interval '1 day');
select ok(not  public.can_deliver(current_setting('t.title_a')::uuid, 'est', 'US', now()),
  'can_deliver: expired grant (effective_to past) excluded');

-- union: adding a second AVOD grant widens coverage
insert into public.rights_grants
  (org_id, title_id, rights_type, territory_mode, territories, effective_from)
values
  (current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
   'avod', 'include', array['CA'], now());
select ok(     public.can_deliver(current_setting('t.title_a')::uuid, 'avod', 'CA', now()),
  'union: second AVOD grant adds CA (scope only grows)');

-- ===== authenticated: tenant isolation + capability matrix =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);

select is((select count(*) from public.rights_grants where org_id = current_setting('t.org_b')::uuid)::int,
  0, 'owner_a CANNOT see org B grants (tenant isolation)');

-- immutability: UPDATE and DELETE both raise (expand-never-contract by construction)
select throws_ok($$ update public.rights_grants set territories = array['XX'] $$,
  '42501', null, 'rights_grants UPDATE blocked (immutable — cannot shrink)');
select throws_ok($$ delete from public.rights_grants $$,
  '42501', null, 'rights_grants DELETE blocked (immutable)');

-- add_rights_grant capability
select lives_ok($$ select public.add_rights_grant(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  array['fast']::public.rights_type[], 'world', '{}', null, null, now()) $$,
  'account_owner: add_rights_grant succeeds');

-- dedupe: duplicate rights types insert one row (returns one id)
select is(array_length(public.add_rights_grant(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  array['bvod','bvod']::public.rights_type[], 'world', '{}', null, null, now()), 1),
  1, 'add_rights_grant dedupes duplicate rights types');

-- territory format validation: a non-alpha-2 code raises at the DB layer
select throws_ok($$ select public.add_rights_grant(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  array['tvod']::public.rights_type[], 'include', array['USA'], null, null, now()) $$,
  'P0001', null, 'add_rights_grant rejects non-alpha-2 territory code');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewer'), 'role', 'authenticated')::text, true);
select throws_ok($$ select public.add_rights_grant(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  array['fast']::public.rights_type[], 'world', '{}', null, null, now()) $$,
  'P0001', null, 'viewer: add_rights_grant raises (not operate-capable)');

reset role;
select * from finish();
rollback;
