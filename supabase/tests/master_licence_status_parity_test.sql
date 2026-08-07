-- master_licence_status_parity_test.sql
--
-- Fix round 3, item 6: the "would this delivery release the master right now" predicate is
-- duplicated THREE times with no shared source — portal_resolve_download (SQL,
-- 20260720000100_portal_gate.sql), title_vendor_licensed (SQL, 20260806000400_attach_link_
-- vendor.sql), and isMasterLicensed (TS, src/lib/master-licence.ts). They agree today, but
-- the status allow-list already drifted once (on 'pending') with nothing to catch it. This
-- file pins the SQL side: portal_resolve_download and title_vendor_licensed must agree with
-- EACH OTHER, across every public.delivery_status enum value, on the same one delivery row.
-- The TS side is pinned separately in master-licence.test.ts
-- (ACTIVE_DELIVERY_STATUSES_LIST) — together these are "assert it identically in both
-- languages," not the shared-RPC consolidation (deliberately out of scope; a separate
-- migration).
--
-- Deliberately NOT a consolidation: this test does not change either function, only proves
-- (and will keep proving) that their allow-lists match — 'pending', 'delivered', 'live' allow;
-- 'rejected', 'taken_down' refuse.

begin;
select plan(10);

-- ---- fixtures (as superuser / owner) --------------------------------------
select set_config('t.org',    gen_random_uuid()::text, false);
select set_config('t.gc',     gen_random_uuid()::text, false);
select set_config('t.owner',  gen_random_uuid()::text, false);
select set_config('t.title',  gen_random_uuid()::text, false);
select set_config('t.grant',  gen_random_uuid()::text, false);
select set_config('t.asset',  gen_random_uuid()::text, false);
select set_config('t.vendor', gen_random_uuid()::text, false);
select set_config('t.deliv',  gen_random_uuid()::text, false);

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
          current_setting('t.vendor')::uuid, current_setting('t.grant')::uuid, 'US', 'pending');

-- One portal_link + session, GC-created, bound to this single delivery/asset — reused across
-- every status flip below (same rows; only deliveries.status changes between assertions).
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role','authenticated')::text, true);
select public.create_portal_link(current_setting('t.deliv')::uuid, current_setting('t.asset')::uuid, 'hash_parity');
reset role;  -- portal_sessions has no direct-INSERT policy for authenticated (RPC-only reads it)
insert into public.portal_sessions (link_id, token_hash, name, company, email, expires_at)
  select id, 'sess_parity', 'Jo Buyer', 'Buyer Co', 'jo@buyer.test', now() + interval '24 hours'
    from public.portal_links where token_hash = 'hash_parity';

-- ---- pending: both functions allow -----------------------------------------------------
update public.deliveries set status = 'pending' where id = current_setting('t.deliv')::uuid;
select is(public.title_vendor_licensed(current_setting('t.title')::uuid, current_setting('t.vendor')::uuid),
  true, 'title_vendor_licensed allows pending');
select lives_ok($$ select public.portal_resolve_download('sess_parity') $$,
  'portal_resolve_download allows pending');

-- ---- delivered: both functions allow ---------------------------------------------------
update public.deliveries set status = 'delivered' where id = current_setting('t.deliv')::uuid;
select is(public.title_vendor_licensed(current_setting('t.title')::uuid, current_setting('t.vendor')::uuid),
  true, 'title_vendor_licensed allows delivered');
select lives_ok($$ select public.portal_resolve_download('sess_parity') $$,
  'portal_resolve_download allows delivered');

-- ---- live: both functions allow --------------------------------------------------------
update public.deliveries set status = 'live' where id = current_setting('t.deliv')::uuid;
select is(public.title_vendor_licensed(current_setting('t.title')::uuid, current_setting('t.vendor')::uuid),
  true, 'title_vendor_licensed allows live');
select lives_ok($$ select public.portal_resolve_download('sess_parity') $$,
  'portal_resolve_download allows live');

-- ---- rejected: both functions refuse ---------------------------------------------------
update public.deliveries set status = 'rejected' where id = current_setting('t.deliv')::uuid;
select is(public.title_vendor_licensed(current_setting('t.title')::uuid, current_setting('t.vendor')::uuid),
  false, 'title_vendor_licensed refuses rejected');
select throws_ok($$ select public.portal_resolve_download('sess_parity') $$,
  'P0001', 'This delivery is no longer active', 'portal_resolve_download refuses rejected');

-- ---- taken_down: both functions refuse -------------------------------------------------
update public.deliveries set status = 'taken_down' where id = current_setting('t.deliv')::uuid;
select is(public.title_vendor_licensed(current_setting('t.title')::uuid, current_setting('t.vendor')::uuid),
  false, 'title_vendor_licensed refuses taken_down');
select throws_ok($$ select public.portal_resolve_download('sess_parity') $$,
  'P0001', 'This delivery is no longer active', 'portal_resolve_download refuses taken_down');

select * from finish();
rollback;
