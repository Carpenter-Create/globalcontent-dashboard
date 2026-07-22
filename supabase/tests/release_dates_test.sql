-- release_dates_test.sql
-- create_title release rules + set_title_release_info (client, operate-gated) +
-- set_release_date (GC-only) + RLS: the client has no release_date write path.

begin;
select plan(12);

select set_config('t.orgA',    gen_random_uuid()::text, false);
select set_config('t.ownerA',  gen_random_uuid()::text, false);
select set_config('t.viewerA', gen_random_uuid()::text, false);
select set_config('t.gc',      gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.ownerA')::uuid),
  (current_setting('t.viewerA')::uuid),
  (current_setting('t.gc')::uuid);
insert into public.organizations (id, name, status) values
  (current_setting('t.orgA')::uuid, 'Org A', 'active');
insert into public.memberships (user_id, org_id, role) values
  (current_setting('t.ownerA')::uuid,  current_setting('t.orgA')::uuid, 'account_owner'),
  (current_setting('t.viewerA')::uuid, current_setting('t.orgA')::uuid, 'viewer');
insert into public.gc_staff (user_id, role) values (current_setting('t.gc')::uuid, 'gc_delivery_ops');

set local role authenticated;

-- ---- create_title: release rules ------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ownerA'),'role','authenticated')::text, true);

select lives_ok(
  format($$ select public.create_title(%L,'New Film','new_release'::public.release_type, null) $$, current_setting('t.orgA')),
  'owner creates a new_release with no original date');

select throws_ok(
  format($$ select public.create_title(%L,'Re Film','re_release'::public.release_type, null) $$, current_setting('t.orgA')),
  'P0001', 'Original release date is required for a re-release',
  're_release requires an original date');

select set_config('t.reTitle',
  (select public.create_title(current_setting('t.orgA')::uuid,'Re Film 2','re_release'::public.release_type, '2019-05-01'))::text, false);
select is((select original_release_date from public.titles where id=current_setting('t.reTitle')::uuid)::text,
  '2019-05-01', 're_release stores the original date');
select is((select release_date from public.titles where id=current_setting('t.reTitle')::uuid), null,
  'create_title never sets release_date (GC-owned)');

select set_config('t.newTitle',
  (select public.create_title(current_setting('t.orgA')::uuid,'New Film 2','new_release'::public.release_type, null))::text, false);

-- ---- set_title_release_info: operate-gated + re-release rule ---------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.viewerA'),'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.set_title_release_info(%L,%L,'new_release'::public.release_type, null) $$,
    current_setting('t.orgA'), current_setting('t.newTitle')),
  'P0001', null, 'viewer cannot edit release info');

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ownerA'),'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.set_title_release_info(%L,%L,'re_release'::public.release_type, null) $$,
    current_setting('t.orgA'), current_setting('t.newTitle')),
  'P0001', 'Original release date is required for a re-release',
  'set_title_release_info enforces the re-release rule');

select lives_ok(
  format($$ select public.set_title_release_info(%L,%L,'new_release'::public.release_type, null) $$,
    current_setting('t.orgA'), current_setting('t.reTitle')),
  'owner switches a re-release to new');
select is((select original_release_date from public.titles where id=current_setting('t.reTitle')::uuid), null,
  'switching to new_release clears the original date');

-- ---- set_release_date: GC-only --------------------------------------------
select throws_ok(
  format($$ select public.set_release_date(%L,'2026-12-01') $$, current_setting('t.newTitle')),
  'P0001', 'Not authorized', 'client owner cannot set release_date');

-- ---- RLS: client has no direct release_date write path --------------------
-- No UPDATE policy on titles for clients (RPC-only); a direct write must not stick,
-- whether RLS no-ops it or the grant denies it.
do $$ begin
  begin
    update public.titles set release_date = '2030-01-01' where id = current_setting('t.newTitle')::uuid;
  exception when others then null;
  end;
end $$;
select is((select release_date from public.titles where id=current_setting('t.newTitle')::uuid), null,
  'direct client UPDATE of release_date does not stick');

-- ---- GC sets it -----------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.gc'),'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.set_release_date(%L,'2026-12-01') $$, current_setting('t.newTitle')),
  'GC sets the release_date');
select is((select release_date from public.titles where id=current_setting('t.newTitle')::uuid)::text,
  '2026-12-01', 'release_date persisted by GC');

reset role;
select * from finish();
rollback;
