-- notifications_test.sql
-- create_notification (GC-only) + RLS org-scoping + per-user read state
-- (mark_notifications_read / my_notifications.unread / my_unread_count).

begin;
select plan(10);

select set_config('t.orgA',   gen_random_uuid()::text, false);
select set_config('t.orgB',   gen_random_uuid()::text, false);
select set_config('t.ownerA', gen_random_uuid()::text, false);
select set_config('t.memberA',gen_random_uuid()::text, false);  -- 2nd member of org A
select set_config('t.ownerB', gen_random_uuid()::text, false);
select set_config('t.gc',     gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.ownerA')::uuid), (current_setting('t.memberA')::uuid),
  (current_setting('t.ownerB')::uuid), (current_setting('t.gc')::uuid);
insert into public.organizations (id, name, status) values
  (current_setting('t.orgA')::uuid, 'Org A', 'active'),
  (current_setting('t.orgB')::uuid, 'Org B', 'active');
insert into public.memberships (user_id, org_id, role) values
  (current_setting('t.ownerA')::uuid,  current_setting('t.orgA')::uuid, 'account_owner'),
  (current_setting('t.memberA')::uuid, current_setting('t.orgA')::uuid, 'viewer'),
  (current_setting('t.ownerB')::uuid,  current_setting('t.orgB')::uuid, 'account_owner');
insert into public.gc_staff (user_id, role) values (current_setting('t.gc')::uuid, 'gc_delivery_ops');

-- ---- create_notification: GC-only ----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ownerA'),'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.create_notification(%L,'title_rejected','T','why',%L::jsonb) $$,
         current_setting('t.orgA'), '{}'),
  'P0001', 'Not authorized', 'client cannot create a notification');

-- direct insert is RPC-only (no insert policy + revoked)
select throws_ok(
  format($$ insert into public.notifications (org_id,kind,title,body,source_refs) values (%L,'title_rejected','T','b','{}'::jsonb) $$,
         current_setting('t.orgA')),
  '42501', null, 'authenticated cannot INSERT notifications directly');

select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.gc'),'role','authenticated')::text, true);
select set_config('t.nid',
  (select public.create_notification(current_setting('t.orgA')::uuid, 'title_rejected', 'Returned',
     '"Film" was returned: fix chain of title', '{"title_id":"x","reason":"fix chain of title"}'::jsonb))::text,
  false);
select is((select count(*) from public.notifications where org_id=current_setting('t.orgA')::uuid)::int, 1,
  'GC created one notification for org A');

-- ---- RLS: org B cannot see org A's notification ---------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ownerB'),'role','authenticated')::text, true);
select is((select count(*) from public.notifications where org_id=current_setting('t.orgA')::uuid)::int, 0,
  'org B owner cannot see org A notifications (RLS)');

-- ---- ownerA: unread → read ------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ownerA'),'role','authenticated')::text, true);
select is((select unread from public.my_notifications() where id=current_setting('t.nid')::uuid), true,
  'ownerA sees the notification unread');
select is(public.my_unread_count(), 1, 'ownerA unread count = 1');
select lives_ok(
  format($$ select public.mark_notifications_read(array[%L]::uuid[]) $$, current_setting('t.nid')),
  'ownerA marks it read');
select is((select unread from public.my_notifications() where id=current_setting('t.nid')::uuid), false,
  'ownerA now sees it read');
select is(public.my_unread_count(), 0, 'ownerA unread count = 0 after read');

-- ---- per-user: the 2nd org A member still sees it unread -------------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.memberA'),'role','authenticated')::text, true);
select is(public.my_unread_count(), 1, 'other org A member still has it unread (per-user read state)');

reset role;
select * from finish();
rollback;
