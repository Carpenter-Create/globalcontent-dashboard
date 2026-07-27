-- portal_test.sql
-- Portal gate: create_portal_link (GC-only, master-asset-only), portal_resolve_download
-- (session + rule-12 grant re-check), revoke_portal_link (GC-only, soft revoke), RLS
-- (client cannot read portal tables), append-only portal_access_events.

begin;
select plan(19);

-- ---- fixtures (as superuser / owner) --------------------------------------
select set_config('t.org',   gen_random_uuid()::text, false);
select set_config('t.gc',    gen_random_uuid()::text, false);
select set_config('t.owner', gen_random_uuid()::text, false);
select set_config('t.title', gen_random_uuid()::text, false);
select set_config('t.grant', gen_random_uuid()::text, false);
select set_config('t.asset', gen_random_uuid()::text, false);
select set_config('t.vendor',gen_random_uuid()::text, false);
select set_config('t.deliv', gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.gc')::uuid), (current_setting('t.owner')::uuid);
insert into public.organizations (id, name, status)
  values (current_setting('t.org')::uuid, 'Org A', 'active');
insert into public.memberships (user_id, org_id, role)
  values (current_setting('t.owner')::uuid, current_setting('t.org')::uuid, 'account_owner');
insert into public.gc_staff (user_id, role)
  values (current_setting('t.gc')::uuid, 'gc_delivery_ops');
insert into public.titles (id, org_id, title, status)
  values (current_setting('t.title')::uuid, current_setting('t.org')::uuid, 'Film', 'in_delivery');
insert into public.rights_grants (id, org_id, title_id, rights_type, territory_mode, territories, effective_from)
  values (current_setting('t.grant')::uuid, current_setting('t.org')::uuid, current_setting('t.title')::uuid,
          'svod', 'world', '{}', now() - interval '1 day');
insert into public.assets (id, org_id, title_id, kind, storage_key, content_hash, bytes)
  values (current_setting('t.asset')::uuid, current_setting('t.org')::uuid, current_setting('t.title')::uuid,
          'master', 'orgs/x/titles/y/master/z/film.mov', 'deadbeef', 1000);
insert into public.vendors (id, name, delivery_mode, active)
  values (current_setting('t.vendor')::uuid, 'Vendor', 'portal_upload', true);
insert into public.deliveries (id, org_id, title_id, vendor_id, grant_id, territory, status)
  values (current_setting('t.deliv')::uuid, current_setting('t.org')::uuid, current_setting('t.title')::uuid,
          current_setting('t.vendor')::uuid, current_setting('t.grant')::uuid, 'US', 'delivered');

-- ---- create_portal_link: GC-only ------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.create_portal_link(%L, %L, %L) $$,
         current_setting('t.deliv'), current_setting('t.asset'), 'hash_client'),
  'P0001', 'Not authorized', 'client cannot create a portal link');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.create_portal_link(%L, %L, %L) $$,
         current_setting('t.deliv'), current_setting('t.asset'), 'hash_ok'),
  'GC creates a portal link');
select is((select count(*) from public.portal_links where token_hash = 'hash_ok')::int, 1,
  'exactly one link row for the token hash');

-- a past p_expires_at is rejected (dead-on-arrival guard)
select throws_ok(
  format($$ select public.create_portal_link(%L, %L, %L, %L) $$,
         current_setting('t.deliv'), current_setting('t.asset'), 'hash_past',
         (now() - interval '1 hour')::text),
  'P0001', 'expires_at must be in the future', 'past expiry rejected');

-- non-master asset rejected. Fixture insert must run as owner: portal_links has
-- no direct-INSERT policy for `authenticated` (RPC-only writes) and neither does
-- `assets` (create_asset() is its sole authenticated write path) — a direct INSERT
-- under role=authenticated would be denied by RLS before the assertion even runs.
-- request.jwt.claims persists across the role switch (set local = true), so the
-- gc identity survives back into `authenticated`.
reset role;
insert into public.assets (id, org_id, title_id, kind, storage_key, content_hash, bytes)
  values (gen_random_uuid(), current_setting('t.org')::uuid, current_setting('t.title')::uuid,
          'poster', 'orgs/x/titles/y/poster/z/art.jpg', 'beef', 10);
set local role authenticated;
-- Scope the lookup to THIS test's title. An unqualified `where kind='poster'` only
-- works on a database that holds exactly one poster, which is true of a fresh CI run
-- and false of any developer machine that has run a seed or a harness — there it
-- returns multiple rows and the assertion dies with 21000 instead of the P0001 it is
-- testing for. The test then fails for a reason that has nothing to do with the code
-- under test.
select throws_ok(
  format($$ select public.create_portal_link(%L, (select id from public.assets where kind='poster' and title_id = %L limit 1), %L) $$,
         current_setting('t.deliv'), current_setting('t.title'), 'hash_art'),
  'P0001', 'Asset must be a master asset on the delivery''s title', 'non-master asset rejected');

-- ---- portal_resolve_download ----------------------------------------------
reset role;  -- fixture inserts into RPC-only / append-only tables run as owner
select set_config('t.link', (select id from public.portal_links where token_hash='hash_ok')::text, false);
insert into public.portal_sessions (id, link_id, token_hash, name, company, email, expires_at)
  values (gen_random_uuid(), current_setting('t.link')::uuid, 'sess_ok', 'Jo Buyer', 'Buyer Co',
          'jo@buyer.test', now() + interval '24 hours')
  returning set_config('t.sess', id::text, false);

select is(
  (select storage_key from public.portal_resolve_download('sess_ok')),
  'orgs/x/titles/y/master/z/film.mov',
  'valid session resolves to the master storage_key');

-- expired session rejected
insert into public.portal_sessions (id, link_id, token_hash, name, company, email, expires_at)
  values (gen_random_uuid(), current_setting('t.link')::uuid, 'sess_expired', 'A','B','a@b.test',
          now() - interval '1 hour');
select throws_ok($$ select public.portal_resolve_download('sess_expired') $$,
  'P0001', 'Session expired or not found', 'expired session rejected');

-- unknown session rejected
select throws_ok($$ select public.portal_resolve_download('nope') $$,
  'P0001', 'Session expired or not found', 'unknown session rejected');

-- revoked link rejected
update public.portal_links set revoked_at = now() where token_hash = 'hash_ok';
select throws_ok($$ select public.portal_resolve_download('sess_ok') $$,
  'P0001', 'Link expired or revoked', 'revoked link rejected');
update public.portal_links set revoked_at = null where token_hash = 'hash_ok';

-- lapsed grant rejected (rule 12 re-check)
update public.rights_grants set effective_to = now() - interval '1 hour'
  where id = current_setting('t.grant')::uuid;
select throws_ok($$ select public.portal_resolve_download('sess_ok') $$,
  'P0001', 'This delivery is no longer covered by an active grant', 'lapsed grant fails closed');
update public.rights_grants set effective_to = null where id = current_setting('t.grant')::uuid;

-- delivery no longer active: taken_down and rejected both block the master download
update public.deliveries set status = 'taken_down' where id = current_setting('t.deliv')::uuid;
select throws_ok($$ select public.portal_resolve_download('sess_ok') $$,
  'P0001', 'This delivery is no longer active', 'taken_down delivery blocks download');
update public.deliveries set status = 'rejected' where id = current_setting('t.deliv')::uuid;
select throws_ok($$ select public.portal_resolve_download('sess_ok') $$,
  'P0001', 'This delivery is no longer active', 'rejected delivery blocks download');
update public.deliveries set status = 'delivered' where id = current_setting('t.deliv')::uuid;

-- ---- revoke_portal_link: GC-only ------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.revoke_portal_link(%L) $$, current_setting('t.link')),
  'P0001', 'Not authorized', 'client cannot revoke a link');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);
select lives_ok(format($$ select public.revoke_portal_link(%L) $$, current_setting('t.link')),
  'GC revokes a link');
select isnt((select revoked_at from public.portal_links where id = current_setting('t.link')::uuid), null,
  'revoked_at is set (soft revoke, not deleted)');

-- ---- RLS: client cannot read portal tables --------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select is((select count(*) from public.portal_links)::int, 0,
  'client SELECT on portal_links returns nothing (GC-only policy)');

-- ---- append-only: nobody can UPDATE portal_access_events ------------------
reset role;
insert into public.portal_access_events (link_id, event_type, email)
  values (current_setting('t.link')::uuid, 'room_viewed', 'jo@buyer.test');
set local role service_role;
select throws_ok(
  $$ update public.portal_access_events set email = 'x' where email = 'jo@buyer.test' $$,
  '42501', null, 'service_role cannot UPDATE append-only access events');

-- portal_links is RPC-only-write: service_role (the route role) has no direct write path,
-- so it cannot un-revoke (UPDATE) or hard-delete a link and bypass the RPC / rule 2.
select throws_ok(
  $$ update public.portal_links set revoked_at = null $$,
  '42501', null, 'service_role cannot UPDATE portal_links (RPC-only writes)');
select throws_ok(
  $$ delete from public.portal_links $$,
  '42501', null, 'service_role cannot DELETE portal_links (rule 2 — soft revoke only)');

reset role;
select * from finish();
rollback;
