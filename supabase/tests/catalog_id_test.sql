-- catalog_id_test.sql
-- Catalog ID: Damm check-digit anchors, auto-assignment, format, uniqueness, immutability.

begin;
select plan(7);

select set_config('t.org', gen_random_uuid()::text, false);
insert into public.organizations (id, name) values (current_setting('t.org')::uuid, 'Org Cat');

-- Damm check digit — documented anchors (payload → check; full number → 0 = valid)
select is(public.gc_check_digit(572), 4, 'Damm(572) = 4');
select is(public.gc_check_digit(5724), 0, 'Damm(5724) = 0 (valid)');

-- auto-assignment + format on insert
select set_config('t.t1', gen_random_uuid()::text, false);
insert into public.titles (id, org_id, title)
  values (current_setting('t.t1')::uuid, current_setting('t.org')::uuid, 'Cat Title One');
select set_config('t.t2', gen_random_uuid()::text, false);
insert into public.titles (id, org_id, title)
  values (current_setting('t.t2')::uuid, current_setting('t.org')::uuid, 'Cat Title Two');

select matches(
  (select catalog_id from public.titles where id = current_setting('t.t1')::uuid),
  '^GC-\d{7}$', 'catalog_id formatted GC- + 7 digits');

-- the generated check digit validates: Damm of (catalog_no*10 + check) = 0
select is(
  public.gc_check_digit(
    (select catalog_no from public.titles where id = current_setting('t.t1')::uuid) * 10
    + right((select catalog_id from public.titles where id = current_setting('t.t1')::uuid), 1)::int),
  0, 'catalog_id check digit validates (Damm full number = 0)');

-- monotonic, distinct
select ok(
  (select catalog_no from public.titles where id = current_setting('t.t2')::uuid)
  > (select catalog_no from public.titles where id = current_setting('t.t1')::uuid),
  'catalog_no increases across inserts');

-- immutability guard
select throws_ok(
  $$ update public.titles set catalog_no = 999999 where id = current_setting('t.t1')::uuid $$,
  'P0001', 'catalog_no is immutable', 'catalog_no cannot be changed');

-- generated column cannot be written directly (Postgres error 428C9)
select throws_ok(
  $$ update public.titles set catalog_id = 'GC-9999999' where id = current_setting('t.t1')::uuid $$,
  '428C9', null, 'catalog_id (generated) cannot be written directly');

select * from finish();
rollback;
