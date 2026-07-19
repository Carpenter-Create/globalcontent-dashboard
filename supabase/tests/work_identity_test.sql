-- work_identity_test.sql
-- territories_overlap truth table; link RPC (GC + client denial); same_work_conflicts
-- (exclusive overlap flagged; non-exclusive pair not; wrong type not; non-overlap not;
-- cross-org; only when linked); suggest_same_work (title+year match, unlinked, cross-org).

begin;
select plan(15);

select set_config('t.org_a', gen_random_uuid()::text, false);
select set_config('t.org_b', gen_random_uuid()::text, false);
select set_config('t.owner', gen_random_uuid()::text, false);  -- client account_owner, org A
select set_config('t.gc',    gen_random_uuid()::text, false);  -- GC staff
select set_config('t.ta',    gen_random_uuid()::text, false);  -- title, org A
select set_config('t.tb',    gen_random_uuid()::text, false);  -- title, org B (same work)

insert into auth.users (id) values (current_setting('t.owner')::uuid), (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'), (current_setting('t.org_b')::uuid, 'Org B');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner')::uuid, 'account_owner', 'active');
insert into public.gc_staff (user_id, role) values (current_setting('t.gc')::uuid, 'gc_delivery_ops');
insert into public.titles (id, org_id, title) values
  (current_setting('t.ta')::uuid, current_setting('t.org_a')::uuid, 'Same Film'),
  (current_setting('t.tb')::uuid, current_setting('t.org_b')::uuid, 'Same Film');
insert into public.title_metadata (title_id, org_id, data) values
  (current_setting('t.ta')::uuid, current_setting('t.org_a')::uuid, '{"release_year":"2024"}'::jsonb),
  (current_setting('t.tb')::uuid, current_setting('t.org_b')::uuid, '{"release_year":"2024"}'::jsonb);

-- ===== territories_overlap truth table =====
select ok(public.territories_overlap('world','{}','include',array['US']), 'overlap: world × include');
select ok(public.territories_overlap('include',array['US','CA'],'include',array['CA']), 'overlap: include ∩ include');
select ok(not public.territories_overlap('include',array['US'],'include',array['CA']), 'no overlap: disjoint includes');
select ok(public.territories_overlap('include',array['US'],'exclude',array['GB']), 'overlap: include US vs exclude GB');
select ok(not public.territories_overlap('include',array['GB'],'exclude',array['GB']), 'no overlap: include GB vs exclude GB');
select ok(public.territories_overlap('exclude',array['US'],'exclude',array['CA']), 'overlap: exclude × exclude');

-- ===== link RPC: client denied, GC links (creates a shared work) =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select public.link_title_to_work_of(%L, %L) $$, current_setting('t.ta'), current_setting('t.tb')),
  'P0001', 'Not authorized', 'client: link denied (not gc_staff)');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select lives_ok(
  format($$ select public.link_title_to_work_of(%L, %L) $$, current_setting('t.ta'), current_setting('t.tb')),
  'gc: link succeeds');
select is(
  (select count(*)::int from public.titles
   where id in (current_setting('t.ta')::uuid, current_setting('t.tb')::uuid)
     and work_id is not null
     and work_id = (select work_id from public.titles where id = current_setting('t.tb')::uuid)),
  2, 'both titles share the same (non-null) work');

-- ===== same_work_conflicts (as GC) =====
-- rights_grants has no direct INSERT policy (writes only via the add_rights_grant
-- SECURITY DEFINER RPC), so fixture inserts here must bypass RLS: reset role around
-- them, then switch back to authenticated (jwt claims persist across the role switch).
-- A: SVOD US exclusive; B: SVOD US non-exclusive → conflict (exclusive involved)
reset role;
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from)
values (current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid, 'svod','include',array['US'], true, now());
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from)
values (current_setting('t.org_b')::uuid, current_setting('t.tb')::uuid, 'svod','include',array['US'], false, now());
set local role authenticated;
select is((select count(*) from public.same_work_conflicts(current_setting('t.ta')::uuid))::int,
  1, 'conflict: exclusive SVOD-US overlaps another org (flagged)');

-- add a non-exclusive-only pair on a different right/territory that must NOT flag:
-- AVOD CA non-exclusive on A; AVOD CA non-exclusive on B → both non-exclusive → no conflict
reset role;
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from)
values (current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid, 'avod','include',array['CA'], false, now());
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from)
values (current_setting('t.org_b')::uuid, current_setting('t.tb')::uuid, 'avod','include',array['CA'], false, now());
set local role authenticated;
select is((select count(*) from public.same_work_conflicts(current_setting('t.ta')::uuid)
           where rights_type = 'avod')::int,
  0, 'no conflict: two non-exclusive AVOD-CA claims coexist');

-- wrong rights_type does not conflict: A tvod US exclusive, B has no tvod
reset role;
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from)
values (current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid, 'tvod','include',array['US'], true, now());
set local role authenticated;
select is((select count(*) from public.same_work_conflicts(current_setting('t.ta')::uuid)
           where rights_type = 'tvod')::int,
  0, 'no conflict: exclusive right with no matching other-org grant');

-- non-overlapping territory does not conflict: A fast GB exclusive, B fast US exclusive
reset role;
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from)
values (current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid, 'fast','include',array['GB'], true, now());
insert into public.rights_grants (org_id, title_id, rights_type, territory_mode, territories, exclusive, effective_from)
values (current_setting('t.org_b')::uuid, current_setting('t.tb')::uuid, 'fast','include',array['US'], true, now());
set local role authenticated;
select is((select count(*) from public.same_work_conflicts(current_setting('t.ta')::uuid)
           where rights_type = 'fast')::int,
  0, 'no conflict: same exclusive right, disjoint territories');

-- ===== client sees no cross-org conflict (RLS fails closed) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select is((select count(*) from public.same_work_conflicts(current_setting('t.ta')::uuid))::int,
  0, 'client: same_work_conflicts returns nothing (RLS scopes out other orgs)');

-- ===== suggestions (as GC): an unlinked same-name+year title in another org =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select set_config('t.tc', gen_random_uuid()::text, false);
reset role;
insert into public.titles (id, org_id, title) values
  (current_setting('t.tc')::uuid, current_setting('t.org_b')::uuid, 'same film');  -- unlinked, org B
insert into public.title_metadata (title_id, org_id, data) values
  (current_setting('t.tc')::uuid, current_setting('t.org_b')::uuid, '{"release_year":"2024"}'::jsonb);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select is((select count(*) from public.suggest_same_work(current_setting('t.ta')::uuid)
           where title_id = current_setting('t.tc')::uuid)::int,
  1, 'suggest: unlinked same-name+year title in another org is surfaced');

reset role;
select * from finish();
rollback;
