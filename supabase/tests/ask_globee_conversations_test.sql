-- ask_globee_conversations_test.sql
-- Cross-org isolation for Ask Globee conversations + messages.
-- Org B must not SELECT / INSERT / UPDATE / DELETE org A's rows.
-- Access UI gating is an app test; this file is RLS only.

begin;
select plan(16);

select set_config('t.orgA',   gen_random_uuid()::text, false);
select set_config('t.orgB',   gen_random_uuid()::text, false);
select set_config('t.ownerA', gen_random_uuid()::text, false);
select set_config('t.viewA',  gen_random_uuid()::text, false);
select set_config('t.ownerB', gen_random_uuid()::text, false);
select set_config('t.cidA',   gen_random_uuid()::text, false);
select set_config('t.midA',   gen_random_uuid()::text, false);
select set_config('t.gidA',   gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.ownerA')::uuid),
  (current_setting('t.viewA')::uuid),
  (current_setting('t.ownerB')::uuid);
insert into public.organizations (id, name, status) values
  (current_setting('t.orgA')::uuid, 'Org A', 'active'),
  (current_setting('t.orgB')::uuid, 'Org B', 'active');
insert into public.memberships (user_id, org_id, role, status) values
  (current_setting('t.ownerA')::uuid, current_setting('t.orgA')::uuid, 'account_owner', 'active'),
  (current_setting('t.viewA')::uuid,  current_setting('t.orgA')::uuid, 'viewer',        'active'),
  (current_setting('t.ownerB')::uuid, current_setting('t.orgB')::uuid, 'account_owner', 'active');

-- ---- org A owner creates a thread + both turns --------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.ownerA'), 'role', 'authenticated')::text, true);

select lives_ok(
  format($sql$
    insert into public.conversations (id, org_id, title, created_by)
    values (%L, %L, 'What needs attention', %L)
  $sql$, current_setting('t.cidA'), current_setting('t.orgA'), current_setting('t.ownerA')),
  'org A owner can insert a conversation into own org');

select lives_ok(
  format($sql$
    insert into public.conversation_messages (id, org_id, conversation_id, role, body)
    values (%L, %L, %L, 'user', 'What needs attention')
  $sql$, current_setting('t.midA'), current_setting('t.orgA'), current_setting('t.cidA')),
  'org A owner can insert a user turn on own conversation');

select lives_ok(
  format($sql$
    insert into public.conversation_messages (id, org_id, conversation_id, role, body, lead, follow)
    values (%L, %L, %L, 'globee', 'Nothing needs attention.', 'Nothing needs attention.', null)
  $sql$, current_setting('t.gidA'), current_setting('t.orgA'), current_setting('t.cidA')),
  'org A owner can insert a globee turn on own conversation');

select is(
  (select count(*) from public.conversations where org_id = current_setting('t.orgA')::uuid)::int,
  1, 'org A owner sees own conversation');
select is(
  (select count(*) from public.conversation_messages where org_id = current_setting('t.orgA')::uuid)::int,
  2, 'org A owner sees own messages');

-- viewer of A uses the same 'view' write capability (not operate)
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewA'), 'role', 'authenticated')::text, true);
select lives_ok(
  format($sql$
    update public.conversation_messages
       set thumbs = 'up'
     where id = %L
  $sql$, current_setting('t.gidA')),
  'org A viewer can update a thumb on an own-org message');

-- ---- org B cannot read or write org A -----------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.ownerB'), 'role', 'authenticated')::text, true);

select is(
  (select count(*) from public.conversations where org_id = current_setting('t.orgA')::uuid)::int,
  0, 'org B cannot SELECT org A conversations');
select is(
  (select count(*) from public.conversation_messages where org_id = current_setting('t.orgA')::uuid)::int,
  0, 'org B cannot SELECT org A messages');

select throws_ok(
  format($sql$
    insert into public.conversations (org_id, title)
    values (%L, 'cross-org')
  $sql$, current_setting('t.orgA')),
  '42501', null, 'org B cannot INSERT a conversation into org A');

select throws_ok(
  format($sql$
    insert into public.conversation_messages (org_id, conversation_id, role, body)
    values (%L, %L, 'user', 'cross-org')
  $sql$, current_setting('t.orgA'), current_setting('t.cidA')),
  '42501', null, 'org B cannot INSERT a message onto an org A conversation');

-- RLS hides the row, so UPDATE/DELETE affect 0 rows rather than 42501.
select lives_ok(
  format($sql$
    update public.conversations set title = 'hacked' where id = %L
  $sql$, current_setting('t.cidA')),
  'org B UPDATE of an org A conversation is a no-op under RLS');
select lives_ok(
  format($sql$
    update public.conversation_messages set body = 'hacked' where id = %L
  $sql$, current_setting('t.midA')),
  'org B UPDATE of an org A message is a no-op under RLS');
select lives_ok(
  format($sql$
    delete from public.conversations where id = %L
  $sql$, current_setting('t.cidA')),
  'org B DELETE of an org A conversation is a no-op under RLS');
select lives_ok(
  format($sql$
    delete from public.conversation_messages where id = %L
  $sql$, current_setting('t.midA')),
  'org B DELETE of an org A message is a no-op under RLS');

reset role;
select is(
  (select title from public.conversations where id = current_setting('t.cidA')::uuid),
  'What needs attention',
  'org A conversation title unchanged after org B write attempts');
select is(
  (select count(*) from public.conversation_messages where conversation_id = current_setting('t.cidA')::uuid)::int,
  2, 'org A messages still present after org B write attempts');

select * from finish();
rollback;
