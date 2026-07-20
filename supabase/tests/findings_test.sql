-- findings_test.sql
-- reconcile_title_findings (operate/GC-gated; upsert + auto-resolve; validator-only) +
-- my_findings + RLS (own-org only) for the findings store (§19).

begin;
select plan(11);

select set_config('t.orgA',   gen_random_uuid()::text, false);
select set_config('t.orgB',   gen_random_uuid()::text, false);
select set_config('t.ownerA', gen_random_uuid()::text, false);
select set_config('t.viewerA',gen_random_uuid()::text, false);
select set_config('t.ownerB', gen_random_uuid()::text, false);
select set_config('t.gc',     gen_random_uuid()::text, false);
select set_config('t.title',  gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.ownerA')::uuid), (current_setting('t.viewerA')::uuid),
  (current_setting('t.ownerB')::uuid), (current_setting('t.gc')::uuid);
insert into public.organizations (id, name, status) values
  (current_setting('t.orgA')::uuid, 'Org A', 'active'),
  (current_setting('t.orgB')::uuid, 'Org B', 'active');
insert into public.memberships (user_id, org_id, role) values
  (current_setting('t.ownerA')::uuid,  current_setting('t.orgA')::uuid, 'account_owner'),
  (current_setting('t.viewerA')::uuid, current_setting('t.orgA')::uuid, 'viewer'),
  (current_setting('t.ownerB')::uuid,  current_setting('t.orgB')::uuid, 'account_owner');
insert into public.gc_staff (user_id, role) values (current_setting('t.gc')::uuid, 'gc_delivery_ops');
insert into public.titles (id, org_id, title, status) values
  (current_setting('t.title')::uuid, current_setting('t.orgA')::uuid, 'Film', 'draft');

-- two-finding payload, and a one-finding subset (drops synopsis)
select set_config('t.two', '[{"code":"metadata.missing.synopsis","severity":"high","message":"Synopsis is required.","field":"synopsis","tier":"required"},{"code":"metadata.missing.genre","severity":"high","message":"Genre is required.","field":"genre","tier":"required"}]', false);
select set_config('t.one', '[{"code":"metadata.missing.genre","severity":"high","message":"Genre is required.","field":"genre","tier":"required"}]', false);

-- ---- reconcile: operate-gated ---------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.viewerA'),'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.reconcile_title_findings(%L,%L,%L::jsonb,'metadata-v1') $$,
         current_setting('t.orgA'), current_setting('t.title'), current_setting('t.two')),
  'P0001', 'Not authorized', 'viewer cannot reconcile findings');

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ownerA'),'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.reconcile_title_findings(%L,%L,%L::jsonb,'metadata-v1') $$,
         current_setting('t.orgA'), current_setting('t.title'), current_setting('t.two')),
  'owner reconciles two findings');
select is((select count(*) from public.findings where entity_id=current_setting('t.title')::uuid and status='open')::int, 2,
  'two open findings after first reconcile');

-- ---- upsert + auto-resolve: re-run with the subset -------------------------
select lives_ok(
  format($$ select public.reconcile_title_findings(%L,%L,%L::jsonb,'metadata-v1') $$,
         current_setting('t.orgA'), current_setting('t.title'), current_setting('t.one')),
  'owner reconciles subset');
select is((select status::text from public.findings where entity_id=current_setting('t.title')::uuid and code='metadata.missing.synopsis'),
  'resolved', 'dropped code auto-resolved');
select is((select status::text from public.findings where entity_id=current_setting('t.title')::uuid and code='metadata.missing.genre'),
  'open', 'remaining code still open');

-- ---- AI findings are never touched by validator reconcile ------------------
reset role;
insert into public.findings (org_id, entity_type, entity_id, code, source, severity, message, source_refs, logic_version)
  values (current_setting('t.orgA')::uuid, 'title', current_setting('t.title')::uuid,
          'ai.genre_mismatch', 'ai', 'low', 'Genre may not match the synopsis.', '{}'::jsonb, 'ai-v1');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ownerA'),'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.reconcile_title_findings(%L,%L,'[]'::jsonb,'metadata-v1') $$,
         current_setting('t.orgA'), current_setting('t.title')),
  'owner reconciles empty set');
select is((select status::text from public.findings where code='ai.genre_mismatch'),
  'open', 'AI finding untouched by validator reconcile');

-- ---- GC can reconcile -----------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.gc'),'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.reconcile_title_findings(%L,%L,%L::jsonb,'metadata-v1') $$,
         current_setting('t.orgA'), current_setting('t.title'), current_setting('t.two')),
  'GC can reconcile findings');

-- ---- RLS: another org cannot see org A's findings; my_findings scoped ------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ownerB'),'role','authenticated')::text, true);
select is((select count(*) from public.findings where entity_id=current_setting('t.title')::uuid)::int, 0,
  'org B owner cannot see org A findings (RLS)');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ownerA'),'role','authenticated')::text, true);
select ok((select count(*) from public.my_findings()) >= 1,
  'owner A my_findings returns own open findings');

reset role;
select * from finish();
rollback;
