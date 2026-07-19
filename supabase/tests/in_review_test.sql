-- in_review_test.sql
-- The in_review gate: submit_title + review_title capability & transitions,
-- title_reviews immutability, and tenant isolation.

begin;
select plan(15);

select set_config('t.org_a',  gen_random_uuid()::text, false);
select set_config('t.org_b',  gen_random_uuid()::text, false);
select set_config('t.owner',  gen_random_uuid()::text, false);  -- account_owner, A
select set_config('t.viewer', gen_random_uuid()::text, false);  -- viewer,        A
select set_config('t.gc',     gen_random_uuid()::text, false);  -- GC staff
select set_config('t.ta',     gen_random_uuid()::text, false);  -- title in org A
select set_config('t.tb',     gen_random_uuid()::text, false);  -- title in org B

insert into auth.users (id) values
  (current_setting('t.owner')::uuid), (current_setting('t.viewer')::uuid), (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'), (current_setting('t.org_b')::uuid, 'Org B');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner')::uuid,  'account_owner', 'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.viewer')::uuid, 'viewer',        'active');
insert into public.gc_staff (user_id, role) values
  (current_setting('t.gc')::uuid, 'gc_delivery_ops');
insert into public.titles (id, org_id, title, status) values
  (current_setting('t.ta')::uuid, current_setting('t.org_a')::uuid, 'Title A', 'draft'),
  (current_setting('t.tb')::uuid, current_setting('t.org_b')::uuid, 'Title B', 'draft');

set local role authenticated;

-- ===== submit_title (client) =====
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewer'), 'role', 'authenticated')::text, true);
select throws_ok($$ select public.submit_title(current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid) $$,
  'P0001', null, 'viewer: submit_title raises (not operate)');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select throws_ok($$ select public.submit_title(current_setting('t.org_a')::uuid, current_setting('t.tb')::uuid) $$,
  'P0001', null, 'owner_a: submit_title on org B title raises (cross-org)');
select lives_ok($$ select public.submit_title(current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid) $$,
  'owner_a: submit_title draft->in_review succeeds');
select is((select status from public.titles where id = current_setting('t.ta')::uuid)::text,
  'in_review', 'title A is now in_review');
select throws_ok($$ select public.submit_title(current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid) $$,
  'P0001', null, 'submit_title again (not draft) raises');

-- ===== review_title (GC only) =====
select throws_ok($$ select public.review_title(current_setting('t.ta')::uuid, 'approve', null) $$,
  'P0001', null, 'client owner: review_title raises (not gc_staff)');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select throws_ok($$ select public.review_title(current_setting('t.ta')::uuid, 'reject', '   ') $$,
  'P0001', null, 'gc: reject with blank reason raises');
select lives_ok($$ select public.review_title(current_setting('t.ta')::uuid, 'reject', 'Chain of title unclear') $$,
  'gc: reject succeeds');
select is((select status from public.titles where id = current_setting('t.ta')::uuid)::text,
  'draft', 'reject returns title to draft');
select is((select reason from public.title_reviews where title_id = current_setting('t.ta')::uuid order by created_at desc limit 1),
  'Chain of title unclear', 'reject reason recorded');

-- resubmit (owner) then approve (gc)
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select lives_ok($$ select public.submit_title(current_setting('t.org_a')::uuid, current_setting('t.ta')::uuid) $$,
  'owner_a: resubmit succeeds');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select lives_ok($$ select public.review_title(current_setting('t.ta')::uuid, 'approve', null) $$,
  'gc: approve succeeds');
select is((select status from public.titles where id = current_setting('t.ta')::uuid)::text,
  'in_delivery', 'approve moves title to in_delivery');

-- ===== title_reviews immutability + isolation =====
select throws_ok($$ update public.title_reviews set reason = 'x' $$,
  '42501', null, 'title_reviews UPDATE blocked (immutable)');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);
select is((select count(*) from public.title_reviews where org_id = current_setting('t.org_b')::uuid)::int,
  0, 'owner_a cannot see org B reviews (tenant isolation)');

reset role;
select * from finish();
rollback;
