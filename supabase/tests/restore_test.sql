-- restore_test.sql
-- Portal-3: portal_event gains 'restore_requested'; append-only still holds for it.

begin;
select plan(2);

-- the new enum label exists
select is(
  (select count(*)::int from pg_enum e
     join pg_type t on t.oid = e.enumtypid
   where t.typname = 'portal_event' and e.enumlabel = 'restore_requested'),
  1, 'portal_event has restore_requested');

-- append-only holds: service_role cannot UPDATE portal_access_events (rule 5)
reset role;
set local role service_role;
select throws_ok(
  $$ update public.portal_access_events set event_type = 'restore_requested' $$,
  '42501', null, 'service_role cannot UPDATE portal_access_events (append-only)');

reset role;
select * from finish();
rollback;
