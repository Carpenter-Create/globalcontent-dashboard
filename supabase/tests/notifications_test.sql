-- notifications_test.sql
-- create_notification (GC-only) + RLS org-scoping + per-user read state
-- (mark_notifications_read / my_notifications.unread / my_unread_count).

begin;
select plan(15);

select set_config('t.orgA',    gen_random_uuid()::text, false);
select set_config('t.orgB',    gen_random_uuid()::text, false);
select set_config('t.ownerA',  gen_random_uuid()::text, false);
select set_config('t.memberA', gen_random_uuid()::text, false);  -- 2nd member of org A
select set_config('t.removedA',gen_random_uuid()::text, false);  -- removed member of org A
select set_config('t.ownerB',  gen_random_uuid()::text, false);
select set_config('t.gc',      gen_random_uuid()::text, false);

insert into auth.users (id, email) values
  (current_setting('t.ownerA')::uuid,   'ownerA@test.example'),
  (current_setting('t.memberA')::uuid,  'memberA@test.example'),
  (current_setting('t.removedA')::uuid, 'removedA@test.example'),
  (current_setting('t.ownerB')::uuid,   'ownerB@test.example'),
  (current_setting('t.gc')::uuid,       'gc@test.example');
insert into public.organizations (id, name, status) values
  (current_setting('t.orgA')::uuid, 'Org A', 'active'),
  (current_setting('t.orgB')::uuid, 'Org B', 'active');
insert into public.memberships (user_id, org_id, role, status) values
  (current_setting('t.ownerA')::uuid,   current_setting('t.orgA')::uuid, 'account_owner', 'active'),
  (current_setting('t.memberA')::uuid,  current_setting('t.orgA')::uuid, 'viewer',        'active'),
  (current_setting('t.removedA')::uuid, current_setting('t.orgA')::uuid, 'viewer',        'removed'),
  (current_setting('t.ownerB')::uuid,   current_setting('t.orgB')::uuid, 'account_owner', 'active');
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

-- A `viewer` CAN mark their own copy read, and that is intended (20260727000100 examined
-- this and left it). `notification_reads` is keyed (notification_id, user_id) and the insert
-- uses auth.uid(), so it changes only what THIS user sees. It is a private UI preference, not
-- an action on the org — which is why 'view' is the right capability rather than 'operate'.
select lives_ok(
  format($$ select public.mark_notifications_read(array[%L]::uuid[]) $$, current_setting('t.nid')),
  'viewer marks their OWN copy read');
select is(public.my_unread_count(), 0, 'viewer unread count = 0 — their own inbox only');
-- And the proof it stayed private: ownerA already read it, so nothing observable changed for
-- anyone else. The per-user assertion above (memberA unread while ownerA read) is the pair.

-- ---- org_notification_recipients: GC-only, active members only -------------
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.gc'),'role','authenticated')::text, true);
select is(
  (select count(*) from public.org_notification_recipients(current_setting('t.orgA')::uuid))::int, 2,
  'GC gets both ACTIVE org A member emails');
select is(
  (select count(*) from public.org_notification_recipients(current_setting('t.orgA')::uuid) r
     where r = 'removedA@test.example')::int, 0,
  'a removed member is excluded from recipients');
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ownerA'),'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.org_notification_recipients(%L) $$, current_setting('t.orgA')),
  'P0001', 'Not authorized', 'a client cannot list org notification recipients');

reset role;
select * from finish();
rollback;
