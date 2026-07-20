-- screener_test.sql
-- Portal-2 screener room: create_screener_link (GC-only, screenable gate),
-- portal_resolve_screener (service-role only, master vs dedicated source, NO rule-12
-- gate), screener_engagement (GC-only, watched_pct/completed/replays math), RLS on
-- screener_view_events + screener-purpose portal_links, and confirmation that Portal-1's
-- create_portal_link still satisfies the generalized portal_links_purpose_shape CHECK.

begin;
select plan(33);

-- ---- fixtures (as superuser / owner) --------------------------------------
select set_config('t.org',     gen_random_uuid()::text, false);
select set_config('t.gc',      gen_random_uuid()::text, false);
select set_config('t.owner',   gen_random_uuid()::text, false);
select set_config('t.title_m', gen_random_uuid()::text, false);  -- screener_source default 'master'
select set_config('t.title_d', gen_random_uuid()::text, false);  -- screener_source 'dedicated'
select set_config('t.title_x', gen_random_uuid()::text, false);  -- 'master' source, no master asset
select set_config('t.asset_m', gen_random_uuid()::text, false);  -- master asset for title_m
select set_config('t.grant',   gen_random_uuid()::text, false);
select set_config('t.vendor',  gen_random_uuid()::text, false);
select set_config('t.deliv',   gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.gc')::uuid), (current_setting('t.owner')::uuid);
insert into public.organizations (id, name, status)
  values (current_setting('t.org')::uuid, 'Org A', 'active');
insert into public.memberships (user_id, org_id, role)
  values (current_setting('t.owner')::uuid, current_setting('t.org')::uuid, 'account_owner');
insert into public.gc_staff (user_id, role)
  values (current_setting('t.gc')::uuid, 'gc_delivery_ops');
insert into public.titles (id, org_id, title, status)
  values (current_setting('t.title_m')::uuid, current_setting('t.org')::uuid, 'Film Master', 'in_delivery');
insert into public.titles (id, org_id, title, status, screener_source)
  values (current_setting('t.title_d')::uuid, current_setting('t.org')::uuid, 'Film Dedicated', 'in_delivery', 'dedicated');
insert into public.titles (id, org_id, title, status)
  values (current_setting('t.title_x')::uuid, current_setting('t.org')::uuid, 'Film No Master', 'in_delivery');
insert into public.assets (id, org_id, title_id, kind, storage_key, content_hash, bytes)
  values (current_setting('t.asset_m')::uuid, current_setting('t.org')::uuid, current_setting('t.title_m')::uuid,
          'master', 'orgs/x/titles/m/master/film.mov', 'deadbeef', 1000);
insert into public.rights_grants (id, org_id, title_id, rights_type, territory_mode, territories, effective_from)
  values (current_setting('t.grant')::uuid, current_setting('t.org')::uuid, current_setting('t.title_m')::uuid,
          'svod', 'world', '{}', now() - interval '1 day');
insert into public.vendors (id, name, delivery_mode, active)
  values (current_setting('t.vendor')::uuid, 'Vendor', 'portal_upload', true);
insert into public.deliveries (id, org_id, title_id, vendor_id, grant_id, territory, status)
  values (current_setting('t.deliv')::uuid, current_setting('t.org')::uuid, current_setting('t.title_m')::uuid,
          current_setting('t.vendor')::uuid, current_setting('t.grant')::uuid, 'US', 'delivered');

-- ============================================================================
-- create_screener_link: GC-only, screenable gate, expiry guard, CHECK shape
-- ============================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.create_screener_link(%L, %L) $$,
         current_setting('t.title_m'), 'tok_client'),
  'P0001', 'Not authorized', 'client cannot create a screener link');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);

-- master path: title_m has a master asset
select lives_ok(
  format($$ select public.create_screener_link(%L, %L) $$,
         current_setting('t.title_m'), 'tok_master'),
  'GC creates a screener link for a master-source title');
select is(
  (select purpose::text from public.portal_links where token_hash = 'tok_master'),
  'screener_view', 'master-path link lands purpose=screener_view');
select is(
  (select (delivery_id is null and asset_id is null and title_id is not null)
     from public.portal_links where token_hash = 'tok_master'),
  true, 'master-path link satisfies the screener_view CHECK shape');

-- past expiry rejected
select throws_ok(
  format($$ select public.create_screener_link(%L, %L, %L) $$,
         current_setting('t.title_m'), 'tok_past', (now() - interval '1 hour')::text),
  'P0001', 'expires_at must be in the future', 'past expiry rejected');

-- master-source title with no master asset: refused
select throws_ok(
  format($$ select public.create_screener_link(%L, %L) $$,
         current_setting('t.title_x'), 'tok_no_master'),
  'P0001', 'No master asset to screen', 'master-source title without a master asset is refused');

-- dedicated path, no screener asset yet: refused
select throws_ok(
  format($$ select public.create_screener_link(%L, %L) $$,
         current_setting('t.title_d'), 'tok_dedicated_fail'),
  'P0001', 'Screener source is set to dedicated but no screener has been uploaded',
  'dedicated title without a screener asset is refused');

-- add the screener asset (fixture insert; reset role — RPC-only elsewhere).
-- request.jwt.claims persists across the role switch (set local = true), so the
-- gc identity survives back into `authenticated` (same idiom as portal_test.sql).
reset role;
insert into public.assets (id, org_id, title_id, kind, storage_key, content_hash, bytes)
  values (gen_random_uuid(), current_setting('t.org')::uuid, current_setting('t.title_d')::uuid,
          'screener', 'orgs/x/titles/d/screener/film_screener.mov', 'beefbeef', 500);
set local role authenticated;
select lives_ok(
  format($$ select public.create_screener_link(%L, %L) $$,
         current_setting('t.title_d'), 'tok_dedicated_ok'),
  'GC creates a screener link once a dedicated screener asset exists');
select is(
  (select purpose::text from public.portal_links where token_hash = 'tok_dedicated_ok'),
  'screener_view', 'dedicated-path link lands purpose=screener_view');

-- ============================================================================
-- Portal-1 shape preserved: create_portal_link still inserts a master_download row
-- ============================================================================
select lives_ok(
  format($$ select public.create_portal_link(%L, %L, %L) $$,
         current_setting('t.deliv'), current_setting('t.asset_m'), 'tok_master_download'),
  'Portal-1 create_portal_link still inserts under the generalized CHECK');
select is(
  (select purpose::text from public.portal_links where token_hash = 'tok_master_download'),
  'master_download', 'master_download link keeps its default purpose');

-- portal_resolve_screener is service-role-only: authenticated is refused at the grant
-- level (checked before any argument/fixture lookup, so a dummy token is fine here).
select throws_ok($$ select public.portal_resolve_screener('nope') $$,
  '42501', null, 'authenticated cannot execute portal_resolve_screener');

-- ============================================================================
-- portal_resolve_screener: master vs dedicated resolution; expired/revoked/wrong-purpose
-- ============================================================================
reset role;  -- fixture inserts into RPC-only / append-only tables run as owner
select set_config('t.link_m',  (select id from public.portal_links where token_hash='tok_master')::text, false);
select set_config('t.link_d',  (select id from public.portal_links where token_hash='tok_dedicated_ok')::text, false);
select set_config('t.link_md', (select id from public.portal_links where token_hash='tok_master_download')::text, false);

insert into public.portal_sessions (id, link_id, token_hash, name, company, email, expires_at)
  values (gen_random_uuid(), current_setting('t.link_m')::uuid, 'sess_m', 'Jo Buyer', 'Buyer Co',
          'jo@buyer.test', now() + interval '24 hours')
  returning set_config('t.sess_m', id::text, false);
insert into public.portal_sessions (id, link_id, token_hash, name, company, email, expires_at)
  values (gen_random_uuid(), current_setting('t.link_d')::uuid, 'sess_d', 'Ann Buyer', 'Buyer Co',
          'ann@buyer.test', now() + interval '24 hours')
  returning set_config('t.sess_d', id::text, false);

select is(
  (select storage_key from public.portal_resolve_screener('sess_m')),
  'orgs/x/titles/m/master/film.mov',
  'master-source title resolves to the master asset storage_key');
select is(
  (select storage_key from public.portal_resolve_screener('sess_d')),
  'orgs/x/titles/d/screener/film_screener.mov',
  'dedicated-source title resolves to the screener asset storage_key');

-- unknown / expired session
select throws_ok($$ select public.portal_resolve_screener('nope') $$,
  'P0001', 'Session expired or not found', 'unknown session rejected');
insert into public.portal_sessions (id, link_id, token_hash, name, company, email, expires_at)
  values (gen_random_uuid(), current_setting('t.link_m')::uuid, 'sess_expired', 'A','B','a@b.test',
          now() - interval '1 hour');
select throws_ok($$ select public.portal_resolve_screener('sess_expired') $$,
  'P0001', 'Session expired or not found', 'expired session rejected');

-- revoked link
update public.portal_links set revoked_at = now() where token_hash = 'tok_master';
select throws_ok($$ select public.portal_resolve_screener('sess_m') $$,
  'P0001', 'Link expired or revoked', 'revoked link rejected');
update public.portal_links set revoked_at = null where token_hash = 'tok_master';

-- expired link
update public.portal_links set expires_at = now() - interval '1 hour' where token_hash = 'tok_master';
select throws_ok($$ select public.portal_resolve_screener('sess_m') $$,
  'P0001', 'Link expired or revoked', 'expired link rejected');
update public.portal_links set expires_at = now() + interval '14 days' where token_hash = 'tok_master';

-- a master_download-purpose link is not a screener link
insert into public.portal_sessions (id, link_id, token_hash, name, company, email, expires_at)
  values (gen_random_uuid(), current_setting('t.link_md')::uuid, 'sess_md', 'C','D','c@d.test',
          now() + interval '24 hours');
select throws_ok($$ select public.portal_resolve_screener('sess_md') $$,
  'P0001', 'Link expired or revoked', 'master_download-purpose link refused by portal_resolve_screener');

-- ============================================================================
-- screener_engagement: watched_pct / completed / replays math (rule 4: derived on read)
-- ============================================================================
-- session A on link_m: completes via an 'ended' event; replayed once (two ended events)
insert into public.screener_view_events (session_id, link_id, event_type, position_seconds, runtime_seconds)
  values (current_setting('t.sess_m')::uuid, current_setting('t.link_m')::uuid, 'play',     0,    3600),
         (current_setting('t.sess_m')::uuid, current_setting('t.link_m')::uuid, 'progress', 1800, 3600),
         (current_setting('t.sess_m')::uuid, current_setting('t.link_m')::uuid, 'ended',    3600, 3600),
         (current_setting('t.sess_m')::uuid, current_setting('t.link_m')::uuid, 'ended',    3600, 3600);

-- session B on link_d: completes via >=95% watched, no 'ended' event (replays clamps to 0)
insert into public.screener_view_events (session_id, link_id, event_type, position_seconds, runtime_seconds)
  values (current_setting('t.sess_d')::uuid, current_setting('t.link_d')::uuid, 'play',     0,    2000),
         (current_setting('t.sess_d')::uuid, current_setting('t.link_d')::uuid, 'progress', 1950, 2000);

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);

select is(
  (select watched_pct from public.screener_engagement(current_setting('t.link_m')::uuid)
     where session_id = current_setting('t.sess_m')::uuid),
  100, 'session A watched_pct = 100');
select is(
  (select completed from public.screener_engagement(current_setting('t.link_m')::uuid)
     where session_id = current_setting('t.sess_m')::uuid),
  true, 'session A completed = true (ended event)');
select is(
  (select replays from public.screener_engagement(current_setting('t.link_m')::uuid)
     where session_id = current_setting('t.sess_m')::uuid),
  1, 'session A replays = 1 (two ended events, floored)');

select is(
  (select watched_pct from public.screener_engagement(current_setting('t.link_d')::uuid)
     where session_id = current_setting('t.sess_d')::uuid),
  98, 'session B watched_pct = 98');
select is(
  (select completed from public.screener_engagement(current_setting('t.link_d')::uuid)
     where session_id = current_setting('t.sess_d')::uuid),
  true, 'session B completed = true (>=95% watched, no ended event)');
select is(
  (select replays from public.screener_engagement(current_setting('t.link_d')::uuid)
     where session_id = current_setting('t.sess_d')::uuid),
  0, 'session B replays clamps to 0 (no ended events)');

-- GC-only: a client sees no rows (the function filters on is_gc_staff inside its WHERE)
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select is(
  (select count(*) from public.screener_engagement(current_setting('t.link_m')::uuid))::int, 0,
  'client sees no engagement rows (GC-only gate inside the function)');

-- ============================================================================
-- RLS: client denied SELECT on screener_view_events + screener-purpose portal_links
-- ============================================================================
select is((select count(*) from public.screener_view_events)::int, 0,
  'client SELECT on screener_view_events returns nothing (GC-only policy)');
select is((select count(*) from public.portal_links where purpose = 'screener_view')::int, 0,
  'client SELECT on screener portal_links returns nothing (GC-only policy)');

-- ============================================================================
-- append-only: nobody can UPDATE/DELETE screener_view_events, incl. service_role
-- ============================================================================
reset role;
set local role service_role;
select throws_ok(
  $$ update public.screener_view_events set position_seconds = 0 $$,
  '42501', null, 'service_role cannot UPDATE screener_view_events (append-only)');
select throws_ok(
  $$ delete from public.screener_view_events $$,
  '42501', null, 'service_role cannot DELETE screener_view_events (append-only)');

-- ---- set_screener_source: member_can('operate')-gated ---------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', gen_random_uuid()::text, 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.set_screener_source(%L, 'dedicated') $$, current_setting('t.title_m')),
  'P0001', 'Not authorized to edit this title', 'non-member cannot set screener_source');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.set_screener_source(%L, 'dedicated') $$, current_setting('t.title_m')),
  'owner sets screener_source');
select is((select screener_source::text from public.titles where id = current_setting('t.title_m')::uuid),
  'dedicated', 'screener_source updated to dedicated');

reset role;
select * from finish();
rollback;
