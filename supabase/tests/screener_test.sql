-- screener_test.sql
-- Portal-2 screener room: create_screener_link (GC + operate-capable client, screenable gate),
-- portal_resolve_screener (service-role only, master vs dedicated source, NO rule-12
-- gate), screener_engagement (GC-only, watched_pct/completed/replays math), RLS on
-- screener_view_events + screener-purpose portal_links, and confirmation that Portal-1's
-- create_portal_link still satisfies the generalized portal_links_purpose_shape CHECK.
--
-- 20260806000300 removed the author partition 20260806000200 introduced: one active screener
-- link per (title, recipient) now, full stop — GC and a client sharing with the same buyer
-- collide on purpose, and a client can read (and revoke) a GC-authored screener_view row for
-- their own org's title. The assertions below that used to prove the partition held now prove
-- the opposite on purpose; see the inline comments at each one. Also covers the two gaps flagged
-- in fix round 1: an explicit positive for the client-revokes-GC's-link grant (the single most
-- consequential capability this migration adds — read-only visibility means nothing if the
-- client can't act on it), and a second-org negative on the widened portal_links_select client
-- branch (the one thing this migration actually widened, so it is exactly where a cross-tenant
-- regression would hide).
--
-- 20260806000400 adds attach_link_vendor (GC-operate only: a client cannot reach this RPC under
-- any role, since vendors is a GC-only roster) and title_vendor_licensed, a small helper it
-- uses to decide when a first attach needs confirmation. NO trigger is attached to portal_links
-- (fix round 1: a table-wide tg_audit would have copied share_token — a live, un-hashed portal
-- credential — and recipient_name into the append-only audit_log with no purge path; see the
-- migration header, which mirrors 20260726000800's own reasoning for portal_sessions). Instead
-- the RPC inserts one hand-built, vendor_id-only audit_log row per genuine transition.
-- Covered below: a client and a read-only gc_legal staffer are both refused; GC with 'operate'
-- succeeds and vendor_id lands, audited with the correct before/after and none of
-- share_token/token_hash/recipient_name; re-attaching the same vendor is a no-op with no new
-- audit row; reassigning to a different vendor is blocked unless p_force is set; a FIRST attach
-- to a vendor that already has an active grant+delivery for the title is ALSO blocked unless
-- forced (the higher-consequence transition — it releases the master immediately); detach
-- (p_vendor_id = null) succeeds without force and is idempotent; an inactive or nonexistent
-- vendor is refused; a master_download link, a revoked link (attach AND detach), an expired
-- link (attach AND detach), and an unknown link id are all refused.
--
-- 20260806000500 closes the last known hole: create_screener_link's client branch now requires
-- a non-blank p_recipient_name (the app-layer guard in createBuyerScreenerLink was cheatable by
-- calling the RPC directly). Covered below: a client omitting the name is refused; a client
-- passing a whitespace-only name is refused (the same btrim fold that already governs storage
-- and the revoke-match); GC's branch is untouched -- omitting the name still succeeds.

begin;
select plan(101);

-- ---- fixtures (as superuser / owner) --------------------------------------
select set_config('t.org',     gen_random_uuid()::text, false);
select set_config('t.gc',      gen_random_uuid()::text, false);
select set_config('t.owner',   gen_random_uuid()::text, false);
select set_config('t.title_m', gen_random_uuid()::text, false);  -- screener_source default 'master'
select set_config('t.title_d', gen_random_uuid()::text, false);  -- screener_source 'dedicated'
select set_config('t.title_x', gen_random_uuid()::text, false);  -- 'master' source, no master asset
select set_config('t.asset_m', gen_random_uuid()::text, false);  -- master asset for title_m
select set_config('t.title_s', gen_random_uuid()::text, false);  -- 'master' source, isolated share-link tests
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
insert into public.titles (id, org_id, title, status)
  values (current_setting('t.title_s')::uuid, current_setting('t.org')::uuid, 'Film Share', 'in_delivery');
insert into public.assets (id, org_id, title_id, kind, storage_key, content_hash, bytes)
  values (gen_random_uuid(), current_setting('t.org')::uuid, current_setting('t.title_s')::uuid,
          'master', 'orgs/x/titles/s/master/film.mov', 'cafecafe', 1000);
-- Client-share fixtures (20260806000200). Isolated titles so the client-authored links here
-- cannot disturb the single-active assertions on title_s further down.
select set_config('t.viewer',  gen_random_uuid()::text, false);  -- 'view' but not 'operate'
select set_config('t.title_c', gen_random_uuid()::text, false);  -- approved: client may share
select set_config('t.title_p', gen_random_uuid()::text, false);  -- pre-approval: client may not
insert into auth.users (id) values (current_setting('t.viewer')::uuid);
insert into public.memberships (user_id, org_id, role)
  values (current_setting('t.viewer')::uuid, current_setting('t.org')::uuid, 'viewer');
insert into public.titles (id, org_id, title, status)
  values (current_setting('t.title_c')::uuid, current_setting('t.org')::uuid, 'Film Client Share', 'in_delivery');
insert into public.titles (id, org_id, title, status)
  values (current_setting('t.title_p')::uuid, current_setting('t.org')::uuid, 'Film Pending', 'draft');
insert into public.assets (id, org_id, title_id, kind, storage_key, content_hash, bytes)
  values (gen_random_uuid(), current_setting('t.org')::uuid, current_setting('t.title_c')::uuid,
          'master', 'orgs/x/titles/c/master/film.mov', 'c0ffee01', 1000);
insert into public.assets (id, org_id, title_id, kind, storage_key, content_hash, bytes)
  values (gen_random_uuid(), current_setting('t.org')::uuid, current_setting('t.title_p')::uuid,
          'master', 'orgs/x/titles/p/master/film.mov', 'c0ffee02', 1000);

-- A second, wholly separate org+member, for the cross-tenant negative on the widened
-- portal_links_select client branch further down. Minimal on purpose: no title of its own is
-- needed, since the assertion is that this member sees NONE of org A's rows, not that they see
-- their own.
select set_config('t.org_b',   gen_random_uuid()::text, false);
select set_config('t.owner_b', gen_random_uuid()::text, false);
insert into auth.users (id) values (current_setting('t.owner_b')::uuid);
insert into public.organizations (id, name, status)
  values (current_setting('t.org_b')::uuid, 'Org B', 'active');
insert into public.memberships (user_id, org_id, role)
  values (current_setting('t.owner_b')::uuid, current_setting('t.org_b')::uuid, 'account_owner');

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

-- 20260806000200: a client MAY share, narrowly. 'operate' on the org, and only once GC has
-- approved the title. (Before that migration any client call raised 'Not authorized'.)
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewer'), 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.create_screener_link(%L, %L) $$,
         current_setting('t.title_c'), 'tok_viewer'),
  'P0001', 'Not authorized', 'a viewer seat cannot create a screener link');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.create_screener_link(%L, %L) $$,
         current_setting('t.title_p'), 'tok_pre'),
  'P0001', 'A screener can be shared once GC has approved the title',
  'client cannot share a title GC has not approved');

-- Unification (20260806000300): same recipient, different authors, now collide on purpose.
-- Neither create call below names a recipient, so both share the same (null) "buyer" under the
-- RPC's `is not distinct from` match — exactly like two callers both typing "Tubi". The old
-- author partition would have kept these on separate sides; it is gone, so the client's create
-- must revoke GC's prior link for that same (unnamed) recipient, leaving exactly one live.
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.create_screener_link(%L, %L) $$,
         current_setting('t.title_c'), 'tok_c_gc'),
  'GC creates its own screener link for the shared title');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.create_screener_link(%L, %L) $$,
         current_setting('t.title_c'), 'tok_c_client'),
  'account_owner creates a screener link on an approved title, revoking GC''s prior link for the same (unnamed) recipient');

-- Checked as GC (gc_can(t.gc, 'view') sees every row regardless of author) so these read the
-- true underlying state rather than whatever the client's own RLS view happens to allow.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);
select is(
  (select revoked_at is not null from public.portal_links where token_hash = 'tok_c_gc'),
  true, 'a same-recipient client link now revokes GC''s link for the same title (no author partition)');
select is(
  (select count(*) from public.portal_links
     where title_id = current_setting('t.title_c')::uuid and purpose = 'screener_view' and revoked_at is null)::int,
  1, 'exactly one active link remains for the shared recipient, regardless of who authored either side');

-- THE headline grant of this migration, proven directly: a client with 'operate' on the title's
-- org can revoke a screener_view link GC created, not merely read it. Read-only visibility of
-- GC's outbound activity would be a half-measure — the founder's stated reason for removing the
-- read partition (this is the client's title and their revenue) applies just as much to acting
-- on it. Named 'Amazon' so its recipient doesn't match tok_c_gc/tok_c_client above (both
-- unnamed — one already revoked, one still the client's own live link) or the Tubi/Roku
-- fixtures created below, and so this revoke can't be mistaken for the recipient-collision
-- revoke inside create_screener_link — this is exercising revoke_portal_link specifically.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.create_screener_link(%L, %L, null::timestamptz, null, %L) $$,
         current_setting('t.title_c'), 'tok_c_gc_amazon', 'Amazon'),
  'GC creates a named screener link for the shared title');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.revoke_portal_link((select id from public.portal_links where token_hash = %L)) $$,
         'tok_c_gc_amazon'),
  'client with ''operate'' revokes a GC-authored screener link on their own org''s title');
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);
select is(
  (select revoked_at is not null from public.portal_links where token_hash = 'tok_c_gc_amazon'),
  true, 'the client''s revoke actually took (checked as GC, which sees every row regardless of author)');

-- Back to the client identity: everything from here through the case-insensitivity block
-- below creates and inspects the CLIENT's own links, which requires 'operate' as t.owner, not
-- GC staff.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);

-- One link per buyer: replacing one recipient's link must not revoke another's. Still the
-- t.owner (client) identity switched back to just above, on the same title_c.
select lives_ok(
  format($$ select public.create_screener_link(%L, %L, null::timestamptz, %L, %L) $$,
         current_setting('t.title_c'), 'tok_buyer_a', 'share_a', 'Tubi'),
  'client creates a link for buyer A');
select lives_ok(
  format($$ select public.create_screener_link(%L, %L, null::timestamptz, %L, %L) $$,
         current_setting('t.title_c'), 'tok_buyer_b', 'share_b', 'Roku'),
  'client creates a link for buyer B on the same title');
select is(
  (select revoked_at from public.portal_links where token_hash = 'tok_buyer_a'),
  null, 'buyer B''s link does not revoke buyer A''s');

-- Same-recipient revoke: recreating a link for the SAME buyer (same casing) must revoke the
-- prior one. Buyer B's non-interference test above proves the predicate doesn't over-revoke;
-- this proves it still under-revokes correctly for the one case the predicate exists for.
select lives_ok(
  format($$ select public.create_screener_link(%L, %L, null::timestamptz, %L, %L) $$,
         current_setting('t.title_c'), 'tok_buyer_a2', 'share_a2', 'Tubi'),
  'client replaces buyer A''s link with a second one for the same recipient');
select is(
  (select revoked_at is not null from public.portal_links where token_hash = 'tok_buyer_a'),
  true, 'recreating buyer A''s link revokes the prior one (single-active per recipient)');

-- Case-insensitive match: a client retyping the same buyer's name with different casing must
-- reset that buyer's existing link, not mint a second live one that leaves the first,
-- already-emailed URL resolvable indefinitely.
select lives_ok(
  format($$ select public.create_screener_link(%L, %L, null::timestamptz, %L, %L) $$,
         current_setting('t.title_c'), 'tok_buyer_a3', 'share_a3', 'TUBI'),
  'client re-shares with buyer A under different casing');
select is(
  (select revoked_at is not null from public.portal_links where token_hash = 'tok_buyer_a2'),
  true, 'differently-cased recipient name still revokes the same buyer''s prior link');
select is(
  (select revoked_at from public.portal_links where token_hash = 'tok_buyer_b'),
  null, 'buyer B''s link is untouched by buyer A''s casing change');

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
-- RLS: client denied screener_view_events; screener-purpose portal_links widened, narrowly
-- ============================================================================
select is((select count(*) from public.screener_view_events)::int, 0,
  'client SELECT on screener_view_events returns nothing (GC-only policy, unchanged)');

-- 20260806000200 widened portal_links_select so a client can re-copy the screener_view link
-- they minted for their own org — that's what "0 screener_view rows visible" used to assert, and
-- was already wrong the moment that migration landed. 20260806000300 widens it further by
-- deleting the author conjunct entirely: a client now sees EVERY screener_view row for their
-- org's title, GC-authored included (tok_c_gc, revoked above, stays visible — RLS is not
-- filtered by revoked_at). That inverts what this assertion used to prove; see the migration
-- header for why hiding GC's outbound activity from the client stopped being defensible once the
-- recipient key made the author partition unnecessary. What still holds unconditionally:
-- master_download rows stay GC-only regardless of org, because a master_download token yields
-- the master itself post-OTP and was never given a share_token.
select is(
  (select count(*) from public.portal_links where token_hash = 'tok_c_gc')::int, 1,
  'client CAN now see GC-authored screener_view rows for their own org''s title (author partition removed)');
select is(
  (select count(*) from public.portal_links where token_hash = 'tok_c_client')::int, 1,
  'client can see their own org''s non-GC-authored screener_view rows (unchanged)');
select is(
  (select count(*) from public.portal_links where purpose = 'master_download')::int, 0,
  'client SELECT on master_download portal_links returns nothing (GC-only, unchanged)');

-- Cross-tenant negative on the branch this migration actually widened. Widening
-- portal_links_select's client branch is exactly the kind of change where a cross-org leak
-- would hide — a member of a completely different org (t.org_b, no membership or relationship
-- to t.org whatsoever) must see NONE of org A's title_c rows, screener_view or otherwise,
-- despite that policy branch no longer caring about author within an org.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner_b'), 'role','authenticated')::text, true);
select is(
  (select count(*) from public.portal_links where title_id = current_setting('t.title_c')::uuid)::int, 0,
  'a member of a different org sees zero portal_links rows for org A''s title (cross-tenant intact under the widened policy)');

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

-- ============================================================================
-- Reusable share link: share_token persists; a second create revokes the first
-- (single active screener link per title). Isolated on title_s so it doesn't
-- disturb the tok_master / tok_dedicated_ok links used above.
-- ============================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);

select lives_ok(
  format($$ select public.create_screener_link(%L, %L, null::timestamptz, %L) $$,
         current_setting('t.title_s'), 'tok_share_1', 'share_aaa'),
  'GC creates a share link carrying a persisted token');
select is(
  (select share_token from public.portal_links where token_hash = 'tok_share_1'),
  'share_aaa', 'share_token is persisted on the screener link');

select lives_ok(
  format($$ select public.create_screener_link(%L, %L, null::timestamptz, %L) $$,
         current_setting('t.title_s'), 'tok_share_2', 'share_bbb'),
  'GC creates a replacement share link for the same title');
select is(
  (select revoked_at is not null from public.portal_links where token_hash = 'tok_share_1'),
  true, 'creating a new share link revokes the prior one (single-active)');
select is(
  (select count(*) from public.portal_links
     where title_id = current_setting('t.title_s')::uuid and purpose = 'screener_view' and revoked_at is null)::int,
  1, 'exactly one active screener link remains per title');

-- ============================================================================
-- attach_link_vendor (20260806000400): GC-operate only, dead-link refusal on both attach and
-- detach, reassignment AND already-licensed first-attach both blocked unless forced, detach
-- supported, and every genuine transition audited as one vendor_id-only row (never the whole
-- portal_links row — see the migration header on why that distinction is the point).
-- ============================================================================
reset role;
select set_config('t.title_v',    gen_random_uuid()::text, false);  -- isolated title for attach tests
select set_config('t.gc_legal',   gen_random_uuid()::text, false);  -- gc_staff, read-only role
select set_config('t.vendor2',    gen_random_uuid()::text, false);  -- second active vendor (reassign target)
select set_config('t.vendor3',    gen_random_uuid()::text, false);  -- already-licensed vendor (first-attach guard)
select set_config('t.vendor_bad', gen_random_uuid()::text, false);  -- inactive vendor
select set_config('t.grant_v',    gen_random_uuid()::text, false);
select set_config('t.deliv_v',    gen_random_uuid()::text, false);
insert into auth.users (id) values (current_setting('t.gc_legal')::uuid);
insert into public.gc_staff (user_id, role) values (current_setting('t.gc_legal')::uuid, 'gc_legal');
insert into public.titles (id, org_id, title, status)
  values (current_setting('t.title_v')::uuid, current_setting('t.org')::uuid, 'Film Vendor Attach', 'in_delivery');
insert into public.assets (id, org_id, title_id, kind, storage_key, content_hash, bytes)
  values (gen_random_uuid(), current_setting('t.org')::uuid, current_setting('t.title_v')::uuid,
          'master', 'orgs/x/titles/v/master/film.mov', 'c0ffee03', 1000);
insert into public.vendors (id, name, delivery_mode, active)
  values (current_setting('t.vendor2')::uuid, 'Vendor Two', 'portal_upload', true);
insert into public.vendors (id, name, delivery_mode, active)
  values (current_setting('t.vendor3')::uuid, 'Vendor Three', 'portal_upload', true);
insert into public.vendors (id, name, delivery_mode, active)
  values (current_setting('t.vendor_bad')::uuid, 'Vendor Inactive', 'portal_upload', false);

-- Vendor Three already has an active world-mode grant and a 'delivered' delivery for title_v —
-- the "would release the master right now" fixture for the first-attach guard below.
insert into public.rights_grants (id, org_id, title_id, rights_type, territory_mode, territories, effective_from)
  values (current_setting('t.grant_v')::uuid, current_setting('t.org')::uuid, current_setting('t.title_v')::uuid,
          'svod', 'world', '{}', now() - interval '1 day');
insert into public.deliveries (id, org_id, title_id, vendor_id, grant_id, territory, status)
  values (current_setting('t.deliv_v')::uuid, current_setting('t.org')::uuid, current_setting('t.title_v')::uuid,
          current_setting('t.vendor3')::uuid, current_setting('t.grant_v')::uuid, 'US', 'delivered');

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.create_screener_link(%L, %L, null::timestamptz, null, %L) $$,
         current_setting('t.title_v'), 'tok_v_buyer', 'Netflix'),
  'client mints a buyer screener link on the isolated attach-test title');
select set_config('t.link_v', (select id::text from public.portal_links where token_hash = 'tok_v_buyer'), false);

-- A second buyer link, target of the first-attach-to-an-already-licensed-vendor guard below.
select lives_ok(
  format($$ select public.create_screener_link(%L, %L, null::timestamptz, null, %L) $$,
         current_setting('t.title_v'), 'tok_v_amazon', 'Amazon'),
  'client mints a second buyer link, target of the first-attach licence guard');
select set_config('t.link_v_amazon', (select id::text from public.portal_links where token_hash = 'tok_v_amazon'), false);

-- A third buyer link, revoked immediately, to prove attach (and detach) refuse a dead link.
select lives_ok(
  format($$ select public.create_screener_link(%L, %L, null::timestamptz, null, %L) $$,
         current_setting('t.title_v'), 'tok_v_revoked', 'Peacock'),
  'client mints a third buyer link, to be revoked');
reset role;
update public.portal_links set revoked_at = now() where token_hash = 'tok_v_revoked';
select set_config('t.link_v_revoked', (select id::text from public.portal_links where token_hash = 'tok_v_revoked'), false);

-- A fourth buyer link, fixture-expired (create_screener_link itself refuses a past expiry, so
-- expiry has to be forced after the fact, same idiom used above for portal_resolve_screener).
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.create_screener_link(%L, %L, null::timestamptz, null, %L) $$,
         current_setting('t.title_v'), 'tok_v_expired', 'Hulu'),
  'client mints a fourth buyer link, to be expired');
reset role;
update public.portal_links set expires_at = now() - interval '1 hour' where token_hash = 'tok_v_expired';
select set_config('t.link_v_expired', (select id::text from public.portal_links where token_hash = 'tok_v_expired'), false);

set local role authenticated;

-- A client can never reach this RPC — vendors is a GC-only roster (see migration header).
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.attach_link_vendor(%L, %L) $$, current_setting('t.link_v'), current_setting('t.vendor')),
  'P0001', 'Not authorized', 'a client (account_owner) cannot attach a vendor to a buyer link');

-- gc_legal is GC staff but "read all, write nothing" — gc_can(...,'operate') must still refuse
-- it, distinct from the client refusal above (is_gc_staff true here, false there).
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc_legal'), 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.attach_link_vendor(%L, %L) $$, current_setting('t.link_v'), current_setting('t.vendor')),
  'P0001', 'Not authorized', 'gc_legal (read-only GC role) cannot attach a vendor');

-- GC with 'operate' succeeds and vendor_id is set. title_v has no grant/delivery for t.vendor,
-- so the first-attach licence guard does not fire here — that path is proven on link_v_amazon
-- below. The audit row is checked for exact before/after AND for the absence of the fields a
-- whole-row trigger would have leaked (fix round 1, item 1's regression test).
--
-- ROW COUNT CHECK (fix round 2, item 1): this is the FIRST attach_link_vendor call on link_v in
-- the whole file — the two throws_ok calls just above raise before reaching the insert, so they
-- write no row. Exactly ONE row matches (entity_id = link_v, action = 'attach_vendor') at this
-- point; `order by at desc limit 1` needs no disambiguating predicate here. (It does two blocks
-- down, once the reassignment adds a second row — see the note there.)
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.attach_link_vendor(%L, %L) $$, current_setting('t.link_v'), current_setting('t.vendor')),
  'GC (operate) attaches a vendor to the buyer link');
select is(
  (select vendor_id from public.portal_links where id = current_setting('t.link_v')::uuid),
  current_setting('t.vendor')::uuid, 'vendor_id is set to the attached vendor');
select is(
  (select (before->>'vendor_id') from public.audit_log
     where entity = 'portal_links' and entity_id = current_setting('t.link_v')::uuid and action = 'attach_vendor'
     order by at desc limit 1),
  null, 'the first attach audits a null "before" vendor_id');
select is(
  (select (after->>'vendor_id')::uuid from public.audit_log
     where entity = 'portal_links' and entity_id = current_setting('t.link_v')::uuid and action = 'attach_vendor'
     order by at desc limit 1),
  current_setting('t.vendor')::uuid, 'the first attach audits the new vendor_id as "after"');

-- Re-attaching the SAME vendor is an idempotent no-op — no force required, and nothing new is
-- audited (audit the transition, not the row: no transition, no row).
select set_config('t.audit_before_noop',
  (select count(*)::text from public.audit_log where entity = 'portal_links' and entity_id = current_setting('t.link_v')::uuid),
  false);
select lives_ok(
  format($$ select public.attach_link_vendor(%L, %L) $$, current_setting('t.link_v'), current_setting('t.vendor')),
  'attaching the same vendor again is a no-op');
select is(
  (select vendor_id from public.portal_links where id = current_setting('t.link_v')::uuid),
  current_setting('t.vendor')::uuid, 'vendor_id is unchanged by the idempotent re-attach');
select is(
  (select count(*)::text from public.audit_log where entity = 'portal_links' and entity_id = current_setting('t.link_v')::uuid),
  current_setting('t.audit_before_noop'), 'the idempotent re-attach writes no additional audit row');

-- Reassigning to a DIFFERENT vendor is blocked unless p_force is passed (judgement call 1a).
select throws_ok(
  format($$ select public.attach_link_vendor(%L, %L) $$, current_setting('t.link_v'), current_setting('t.vendor2')),
  'P0001', 'Link already has a different vendor attached — pass force to reassign',
  'reassigning to a different vendor without force is refused');
select is(
  (select vendor_id from public.portal_links where id = current_setting('t.link_v')::uuid),
  current_setting('t.vendor')::uuid, 'vendor_id is untouched by the refused reassignment');

-- With p_force := true it succeeds — and the transition is captured in audit_log as a single
-- vendor_id-only row (judgement call 1's other half: allowed, but never silent), which is
-- checked below for the correct before/after AND for the absence of live-credential fields.
--
-- DISAMBIGUATION (fix round 2, item 1): two rows now match (entity_id = link_v, action =
-- 'attach_vendor') — the first attach above and this reassignment — and `at` defaults to
-- now(), i.e. transaction_timestamp(), which is IDENTICAL for every row in this file: the
-- whole suite runs inside one begin/rollback. `order by at desc limit 1` has no tiebreak
-- between equal timestamps, so which of the two rows a bounded top-N sort returns is not
-- something this test may assume. Every query below that targets THIS reassignment's row
-- additionally filters on `after->>'vendor_id' = t.vendor2`, which only the reassignment row
-- satisfies (the first attach's `after` is t.vendor) — that predicate alone narrows the match
-- to exactly one row; `order by ... limit 1` is kept only as defensive belt-and-braces.
select lives_ok(
  format($$ select public.attach_link_vendor(%L, %L, true) $$, current_setting('t.link_v'), current_setting('t.vendor2')),
  'forced reassignment to a different vendor succeeds');
select is(
  (select vendor_id from public.portal_links where id = current_setting('t.link_v')::uuid),
  current_setting('t.vendor2')::uuid, 'vendor_id reflects the forced reassignment');
select is(
  (select (before->>'vendor_id')::uuid from public.audit_log
     where entity = 'portal_links' and entity_id = current_setting('t.link_v')::uuid and action = 'attach_vendor'
       and (after->>'vendor_id')::uuid = current_setting('t.vendor2')::uuid
     order by at desc limit 1),
  current_setting('t.vendor')::uuid, 'the reassignment audits the OLD vendor_id as "before"');
select is(
  (select (after->>'vendor_id')::uuid from public.audit_log
     where entity = 'portal_links' and entity_id = current_setting('t.link_v')::uuid and action = 'attach_vendor'
       and (after->>'vendor_id')::uuid = current_setting('t.vendor2')::uuid
     order by at desc limit 1),
  current_setting('t.vendor2')::uuid, 'the reassignment audits the NEW vendor_id as "after"');

-- REGRESSION GUARD for fix round 1, item 1: the whole reason a table-wide trigger was wrong.
-- If a future change ever goes back to to_jsonb(row), these three fail immediately.
--
-- Same two rows match here as above (still entity_id = link_v, action = 'attach_vendor'), so
-- the same disambiguating predicate is required — even though, AS WRITTEN TODAY, both rows
-- would give the same true/false answer (neither ever carries these keys, by construction).
-- Relying on that coincidence would be exactly the kind of test-theatre this repo has been
-- burned by before (a bypass and a correct refusal returning the same observable result,
-- masking the bypass — Task 9's fix-round-2 note): pin these to the SAME specific row the
-- before/after assertions above just proved, not to "whichever of two rows happens to match."
select is(
  (select (after ? 'share_token') from public.audit_log
     where entity = 'portal_links' and entity_id = current_setting('t.link_v')::uuid and action = 'attach_vendor'
       and (after->>'vendor_id')::uuid = current_setting('t.vendor2')::uuid
     order by at desc limit 1),
  false, 'the audit row''s "after" never carries share_token (the live, un-hashed portal credential)');
select is(
  (select (after ? 'token_hash') from public.audit_log
     where entity = 'portal_links' and entity_id = current_setting('t.link_v')::uuid and action = 'attach_vendor'
       and (after->>'vendor_id')::uuid = current_setting('t.vendor2')::uuid
     order by at desc limit 1),
  false, 'the audit row''s "after" never carries token_hash');
select is(
  (select (after ? 'recipient_name') from public.audit_log
     where entity = 'portal_links' and entity_id = current_setting('t.link_v')::uuid and action = 'attach_vendor'
       and (after->>'vendor_id')::uuid = current_setting('t.vendor2')::uuid
     order by at desc limit 1),
  false, 'the audit row''s "after" never carries recipient_name (external-party PII)');

-- FIRST ATTACH to an ALREADY-LICENSED vendor (judgement call 1b, fix round 1 item 3): the
-- higher-consequence transition. Vendor Three already has a 'delivered' delivery under an
-- active world-mode grant for title_v, so attaching it to link_v_amazon (still vendor-less)
-- would make the master reachable through that link immediately — blocked unless forced too.
select throws_ok(
  format($$ select public.attach_link_vendor(%L, %L) $$, current_setting('t.link_v_amazon'), current_setting('t.vendor3')),
  'P0001',
  'This vendor already has an active grant and delivery for this title — attaching releases the master immediately. Pass force to confirm.',
  'first attach to an already-licensed vendor is refused without force');
select is(
  (select vendor_id from public.portal_links where id = current_setting('t.link_v_amazon')::uuid),
  null, 'vendor_id is untouched by the refused first attach');
select lives_ok(
  format($$ select public.attach_link_vendor(%L, %L, true) $$, current_setting('t.link_v_amazon'), current_setting('t.vendor3')),
  'forced first attach to an already-licensed vendor succeeds');
select is(
  (select vendor_id from public.portal_links where id = current_setting('t.link_v_amazon')::uuid),
  current_setting('t.vendor3')::uuid, 'vendor_id reflects the forced first attach');

-- DETACH (fix round 1, item 4): p_vendor_id passed as an explicit null removes the vendor. No
-- force needed — the safe direction, the mirror image of judgement call 1 — and it is audited
-- (action distinct from attach: 'detach_vendor') the same way any other genuine transition is.
--
-- ROW COUNT CHECK (fix round 2, item 1): action = 'detach_vendor' has never been inserted for
-- link_v before this call (the two prior transitions on this link were both 'attach_vendor',
-- a different action string, so they don't share this filter). Exactly ONE row matches below —
-- no disambiguating predicate needed, unlike the 'attach_vendor' queries above.
select lives_ok(
  format($$ select public.attach_link_vendor(%L, null) $$, current_setting('t.link_v')),
  'GC detaches the vendor from a buyer link');
select is(
  (select vendor_id from public.portal_links where id = current_setting('t.link_v')::uuid),
  null, 'vendor_id is cleared by detach');
select is(
  (select (before->>'vendor_id')::uuid from public.audit_log
     where entity = 'portal_links' and entity_id = current_setting('t.link_v')::uuid and action = 'detach_vendor'
     order by at desc limit 1),
  current_setting('t.vendor2')::uuid, 'the detach audits the OLD vendor_id as "before"');
select is(
  (select (after->>'vendor_id') from public.audit_log
     where entity = 'portal_links' and entity_id = current_setting('t.link_v')::uuid and action = 'detach_vendor'
     order by at desc limit 1),
  null, 'the detach audits a null "after" vendor_id');

-- Detaching an already-vendor-less link is an idempotent no-op — nothing audited a second time.
select lives_ok(
  format($$ select public.attach_link_vendor(%L, null) $$, current_setting('t.link_v')),
  'detaching an already-vendor-less link is a no-op');
select is(
  (select count(*)::text from public.audit_log
     where entity = 'portal_links' and entity_id = current_setting('t.link_v')::uuid and action = 'detach_vendor'),
  '1', 'the idempotent re-detach writes no additional audit row');

-- Re-attaching after a detach goes through the FIRST-ATTACH path again (vendor_id is null once
-- more) and is unguarded here too — title_v has no grant/delivery for t.vendor2, so the licence
-- guard correctly does not fire on every first attach, only on already-licensed pairs.
select lives_ok(
  format($$ select public.attach_link_vendor(%L, %L) $$, current_setting('t.link_v'), current_setting('t.vendor2')),
  'attaching a vendor again after a detach succeeds without force');

-- An inactive vendor is refused outright, regardless of the current attachment.
select throws_ok(
  format($$ select public.attach_link_vendor(%L, %L, true) $$, current_setting('t.link_v'), current_setting('t.vendor_bad')),
  'P0001', 'Vendor is not active', 'an inactive vendor is refused');

-- A vendor id that doesn't exist at all is refused with a distinct message.
select throws_ok(
  format($$ select public.attach_link_vendor(%L, %L) $$, current_setting('t.link_v'), gen_random_uuid()::text),
  'P0001', 'Vendor not found', 'a nonexistent vendor id is refused');

-- A master_download link (not a buyer pitch link) cannot carry a vendor through this RPC.
select throws_ok(
  format($$ select public.attach_link_vendor(%L, %L) $$,
         (select id from public.portal_links where token_hash = 'tok_master_download'), current_setting('t.vendor')),
  'P0001', 'Only a buyer screener link can carry a vendor',
  'a master_download link is refused (buyer links only)');

-- Dead links: revoked and expired are both refused, no force override (judgement call 2) — on
-- BOTH the attach and the detach path, since writing into a dead link either direction is
-- equally pointless (nothing can ever resolve it again).
select throws_ok(
  format($$ select public.attach_link_vendor(%L, %L) $$, current_setting('t.link_v_revoked'), current_setting('t.vendor')),
  'P0001', 'Link has been revoked', 'a revoked buyer link refuses attach');
select throws_ok(
  format($$ select public.attach_link_vendor(%L, null) $$, current_setting('t.link_v_revoked')),
  'P0001', 'Link has been revoked', 'a revoked buyer link refuses detach too');
select throws_ok(
  format($$ select public.attach_link_vendor(%L, %L) $$, current_setting('t.link_v_expired'), current_setting('t.vendor')),
  'P0001', 'Link has expired', 'an expired buyer link refuses attach');
select throws_ok(
  format($$ select public.attach_link_vendor(%L, null) $$, current_setting('t.link_v_expired')),
  'P0001', 'Link has expired', 'an expired buyer link refuses detach too');

-- Unknown link id.
select throws_ok(
  format($$ select public.attach_link_vendor(%L, %L) $$, gen_random_uuid()::text, current_setting('t.vendor')),
  'P0001', 'Link not found', 'an unknown link id is refused');

-- ============================================================================
-- create_screener_link (20260806000500): client branch requires a non-blank buyer name
-- ============================================================================
-- title_v: 'in_delivery' (client-approved) with a master asset, so both the status gate and
-- the screenable-asset gate above are already satisfied here — isolating this block to the new
-- guard alone, which fires before either of those would matter for this call. t.owner already
-- holds 'operate' on t.org (fixtures at the top of the file).
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role','authenticated')::text, true);
select throws_ok(
  format($$ select public.create_screener_link(%L, %L) $$,
         current_setting('t.title_v'), 'tok_v_noname'),
  'P0001', 'A buyer name is required', 'a client caller omitting the recipient name is refused');

-- Whitespace-only is not a name either -- the same btrim fold the RPC already applies before
-- storing/matching recipient_name, checked explicitly so a caller can't dodge the guard above
-- by sending spaces instead of nothing.
select throws_ok(
  format($$ select public.create_screener_link(%L, %L, null::timestamptz, null, %L) $$,
         current_setting('t.title_v'), 'tok_v_blank', '   '),
  'P0001', 'A buyer name is required', 'a client caller passing a whitespace-only recipient name is refused');

-- GC's branch is untouched: the exemption in the buyer-link gate (recipient_name null = GC's
-- own operational link) depends on GC still being able to omit the name entirely, exactly as
-- gc/review/actions.ts's createScreenerLink does.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);
select lives_ok(
  format($$ select public.create_screener_link(%L, %L) $$,
         current_setting('t.title_v'), 'tok_v_gc_noname'),
  'GC omitting the recipient name still succeeds');

reset role;
select * from finish();
rollback;
