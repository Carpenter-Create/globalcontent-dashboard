-- export_test.sql
-- submit_title required-metadata gate; record_export GC-only + append-only + RLS.

begin;
select plan(9);

select set_config('t.org', gen_random_uuid()::text, false);
select set_config('t.owner', gen_random_uuid()::text, false);
select set_config('t.gc', gen_random_uuid()::text, false);
select set_config('t.title', gen_random_uuid()::text, false);
select set_config('t.vendor', gen_random_uuid()::text, false);
select set_config('t.tdraft', gen_random_uuid()::text, false);  -- never reviewed, for the gate's negative case

insert into auth.users (id) values (current_setting('t.owner')::uuid), (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values (current_setting('t.org')::uuid, 'Org A');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org')::uuid, current_setting('t.owner')::uuid, 'account_owner', 'active');
insert into public.gc_staff (user_id, role) values (current_setting('t.gc')::uuid, 'gc_delivery_ops');
-- t.title deliberately keeps the 'draft' default: the submit_title assertions below need it.
insert into public.titles (id, org_id, title) values
  (current_setting('t.title')::uuid, current_setting('t.org')::uuid, 'Film'),
  (current_setting('t.tdraft')::uuid, current_setting('t.org')::uuid, 'Never Reviewed');
insert into public.vendors (id, name, delivery_mode) values
  (current_setting('t.vendor')::uuid, 'Endpoint', 'portal_upload');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);

-- submit blocked: no metadata at all
select throws_ok(
  format($$ select public.submit_title(%L, %L) $$, current_setting('t.org'), current_setting('t.title')),
  'P0001', null, 'submit blocked when required metadata missing (no row)');

-- submit blocked: partial metadata (missing country_of_origin)
reset role;
insert into public.title_metadata (title_id, org_id, data) values
  (current_setting('t.title')::uuid, current_setting('t.org')::uuid,
   '{"synopsis":"x","runtime_minutes":100,"release_year":2024,"genre":"drama","primary_language":"en"}'::jsonb);
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select throws_ok(
  format($$ select public.submit_title(%L, %L) $$, current_setting('t.org'), current_setting('t.title')),
  'P0001', null, 'submit blocked when a required field missing (country_of_origin)');

-- submit succeeds once all required present
reset role;
update public.title_metadata set data = data || '{"country_of_origin":"US"}'::jsonb
  where title_id = current_setting('t.title')::uuid;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select lives_ok(
  format($$ select public.submit_title(%L, %L) $$, current_setting('t.org'), current_setting('t.title')),
  'submit succeeds when all required metadata present');
select is((select status::text from public.titles where id = current_setting('t.title')::uuid),
  'in_review', 'title advanced to in_review');

-- record_export: client denied, GC ok, append-only
select throws_ok(
  format($$ select public.record_export(%L, array[%L]::uuid[], '{}'::jsonb) $$, current_setting('t.vendor'), current_setting('t.title')),
  'P0001', 'Not authorized', 'client: record_export denied');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);

-- As of 20260726000100 an export may only name titles approved for delivery. Advance this
-- one through the REAL path — GC review — rather than writing the column, so the fixture
-- reaches in_delivery the same way production does.
select public.review_title(current_setting('t.title')::uuid, 'approve', null);
select is((select status::text from public.titles where id = current_setting('t.title')::uuid),
  'in_delivery', 'review advanced the title to in_delivery');

select lives_ok(
  format($$ select public.record_export(%L, array[%L]::uuid[], '[{"Title":"Film"}]'::jsonb) $$, current_setting('t.vendor'), current_setting('t.title')),
  'gc: record_export succeeds');

-- ===== chain-of-title gate: the NEGATIVE case (20260726000100) =====
-- Approving the title above restores the positive assertion but proves nothing about the
-- gate. This asserts it refuses, and refuses for the right reason.
select throws_like(
  format($$ select public.record_export(%L, array[%L]::uuid[], '[]'::jsonb) $$, current_setting('t.vendor'), current_setting('t.tdraft')),
  '%Chain of title%', 'gate: record_export REFUSES a never-reviewed (draft) title');
select throws_ok(
  $$ update public.export_records set payload = '{}'::jsonb $$,
  '42501', null, 'export_records is append-only (direct UPDATE denied)');

reset role;
select * from finish();
rollback;
