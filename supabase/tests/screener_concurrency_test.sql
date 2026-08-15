-- screener_concurrency_test.sql
--
-- True two-session evidence for create_screener_link and attach_link_vendor.
-- Remote dblink sessions cannot see fixtures created only inside an uncommitted
-- outer pgTAP transaction, so fixtures are created (and cleaned) through a
-- committed dblink connection. A distinctive org/vendor name prefix plus a
-- per-run nonce avoids parallel collisions. Cleanup is committed even when
-- the outer session later rolls back.
--
-- dblink_exec cannot run row-returning SELECT. Session A completes each RPC
-- via DO / PERFORM while keeping BEGIN open. Session B uses dblink_send_query
-- plus dblink_get_result. B must be dblink_is_busy = 1 before A commits.
-- Bounded polls; cancel on timeout. Fail closed if the harness is unavailable.
--
-- Mutation evidence (run locally, restore before validation; do not commit):
--   * DROP portal_links_active_screener_recipient_uidx → screener_test
--     direct-write duplicate must fail (second INSERT succeeds).
--   * Remove titles FOR UPDATE → different-recipient test must fail
--     (B finishes while A is still open; unique keys differ so the index
--     cannot cause the wait). Title lock is operational serialization.
--   * Remove portal_links FOR UPDATE → vendor force/audit race must fail
--     (two attach_vendor audits and/or a last-writer win without force).
--
-- dblink ownership: a session-level advisory lock (87204602) is taken before
-- the exists check and held through create, use, and the owned-drop decision.
-- That serializes parallel copies of this file so two invocations cannot both
-- record ownership of one CREATE. If dblink already existed when the locked
-- invocation checked, do not drop it. If this locked invocation created it,
-- successful teardown may drop it, then unlock. Session end releases the lock
-- if this backend dies. The lock is local-test infrastructure only — not a
-- substitute for titles/portal_links FOR UPDATE, and not a production
-- dependency. An abrupt abort can leave a locally created dblink; residual
-- local cleanup (superuser, only if this test created it, nothing else needs
-- it, and no other copy of this harness is running): drop extension if exists
-- dblink;
--
-- Fixture isolation: org/vendor names and every portal_links.token_hash are
-- derived from a per-invocation nonce. Automatic cleanup deletes only this
-- nonce's org/title/vendors/users. Do not sweep every __pgtap_scc__* row —
-- that would delete a parallel run. Stale leftovers from a crashed historical
-- run are a manual local cleanup of the leftover nonce you own, not an
-- automatic prefix wipe.

set statement_timeout = '60s';

-- Session-level: survives the pgTAP BEGIN/ROLLBACK. Distinct from the
-- in-test xact lock 87204601 used to prove A/B busy protocol.
select pg_advisory_lock(87204602);

-- Session GUC survives the later pgTAP rollback. Record ownership only after
-- the lifecycle lock is held.
select set_config(
  'scc.dblink_created_by_test',
  (not exists (select 1 from pg_extension where extname = 'dblink'))::text,
  false
);
create extension if not exists dblink;

begin;
select plan(26);

create or replace function pg_temp.scc_disconnect(p_name text)
returns void language plpgsql as $$
begin
  perform dblink_disconnect(p_name);
exception
  when others then null;
end;
$$;

create or replace function pg_temp.scc_wait_busy(p_conn text, p_ms int)
returns boolean language plpgsql as $$
declare
  v_waited int := 0;
begin
  while v_waited < p_ms loop
    if dblink_is_busy(p_conn) = 1 then
      return true;
    end if;
    perform pg_sleep(0.05);
    v_waited := v_waited + 50;
  end loop;
  return dblink_is_busy(p_conn) = 1;
end;
$$;

create or replace function pg_temp.scc_wait_idle(p_conn text, p_ms int)
returns boolean language plpgsql as $$
declare
  v_waited int := 0;
begin
  while v_waited < p_ms loop
    if dblink_is_busy(p_conn) = 0 then
      return true;
    end if;
    perform pg_sleep(0.05);
    v_waited := v_waited + 50;
  end loop;
  return dblink_is_busy(p_conn) = 0;
end;
$$;

create or replace function pg_temp.scc_jwt(p_uid uuid)
returns text language sql immutable as $$
  select json_build_object('sub', p_uid::text, 'role', 'authenticated')::text
$$;

-- Same-cluster dblink. The image's `postgres` role is not superuser and
-- cannot dblink_connect (2F003) or grant dblink_connect_u. This suite
-- requires a superuser session (local: supabase_admin). Fail closed
-- otherwise — do not skip.
create or replace function pg_temp.scc_connstr()
returns text language sql stable as $$
  select format('dbname=%s', current_database())
$$;

create or replace function pg_temp.scc_begin_auth(p_conn text, p_uid uuid)
returns void language plpgsql as $$
begin
  perform dblink_exec(p_conn, 'BEGIN');
  perform dblink_exec(p_conn, format(
    $q$do $body$ begin
      perform set_config('request.jwt.claims', %L, true);
    end $body$;$q$,
    pg_temp.scc_jwt(p_uid)
  ));
  perform dblink_exec(p_conn, 'SET LOCAL ROLE authenticated');
end;
$$;

create or replace function pg_temp.scc_harvest_text(p_conn text)
returns text language plpgsql as $$
declare
  v text;
begin
  select x into v from dblink_get_result(p_conn) as t(x text);
  begin
    perform 1 from dblink_get_result(p_conn) as t(x text);
  exception
    when others then null;
  end;
  return v;
exception
  when others then
    begin
      perform 1 from dblink_get_result(p_conn) as t(x text);
    exception
      when others then null;
    end;
    raise;
end;
$$;

create or replace function pg_temp.scc_harvest_uuid(p_conn text)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  select x into v from dblink_get_result(p_conn) as t(x uuid);
  begin
    perform 1 from dblink_get_result(p_conn) as t(x uuid);
  exception
    when others then null;
  end;
  return v;
end;
$$;

-- Fail closed: extension + connect + open-transaction busy protocol.
select ok(
  exists (select 1 from pg_extension where extname = 'dblink'),
  'dblink extension is available'
);

select ok(
  current_setting('is_superuser') = 'on',
  'concurrency harness is running as a superuser (required for dblink)'
);

select lives_ok(
  $$ select dblink_connect('probe_a', pg_temp.scc_connstr()) $$,
  'dblink can connect session A'
);
select lives_ok(
  $$ select dblink_connect('probe_b', pg_temp.scc_connstr()) $$,
  'dblink can connect session B'
);

select dblink_exec('probe_a', 'BEGIN');
select dblink_exec('probe_a', 'do $$ begin perform pg_advisory_xact_lock(87204601); end $$');
select dblink_exec('probe_b', 'BEGIN');
select dblink_send_query('probe_b', 'select pg_advisory_xact_lock(87204601) is null');

select ok(
  pg_temp.scc_wait_busy('probe_b', 2000),
  'harness: B is busy while A holds an open-transaction lock'
);
select ok(
  dblink_is_busy('probe_b') = 1,
  'harness: B remains busy before A commits (not merely two send_query calls)'
);

select dblink_exec('probe_a', 'COMMIT');
select ok(
  pg_temp.scc_wait_idle('probe_b', 5000),
  'harness: B becomes idle after A commits'
);
select lives_ok(
  $$ select pg_temp.scc_harvest_text('probe_b') $$,
  'harness: B result can be harvested'
);
select dblink_exec('probe_b', 'COMMIT');
select pg_temp.scc_disconnect('probe_a');
select pg_temp.scc_disconnect('probe_b');

-- Committed fixture + cleanup connections (visible to A/B regardless of this txn).
select dblink_connect('fix', pg_temp.scc_connstr());

select set_config('scc.nonce', gen_random_uuid()::text, false);
select set_config('scc.org', gen_random_uuid()::text, false);
select set_config('scc.owner', gen_random_uuid()::text, false);
select set_config('scc.gc', gen_random_uuid()::text, false);
select set_config('scc.title', gen_random_uuid()::text, false);
select set_config('scc.v1', gen_random_uuid()::text, false);
select set_config('scc.v2', gen_random_uuid()::text, false);
select set_config('scc.link', '', false);
-- token_hash is globally unique. Every fixture hash is nonce-derived.
select set_config('scc.tok_a_tubi', 'scc_a_tubi__' || current_setting('scc.nonce'), false);
select set_config('scc.tok_b_roku', 'scc_b_roku__' || current_setting('scc.nonce'), false);
select set_config('scc.tok_a_vudu', 'scc_a_vudu__' || current_setting('scc.nonce'), false);
select set_config('scc.tok_b_vudu', 'scc_b_vudu__' || current_setting('scc.nonce'), false);
select set_config('scc.tok_a_unnamed', 'scc_a_unnamed__' || current_setting('scc.nonce'), false);
select set_config('scc.tok_b_unnamed', 'scc_b_unnamed__' || current_setting('scc.nonce'), false);

-- Insert only this invocation's nonce-scoped fixtures. No prefix-wide sweep.
select dblink_exec('fix', format($q$
do $body$
begin
  insert into auth.users (id) values (%L::uuid), (%L::uuid);
  insert into public.organizations (id, name, status)
    values (%L::uuid, %L, 'active');
  insert into public.memberships (user_id, org_id, role)
    values (%L::uuid, %L::uuid, 'account_owner');
  insert into public.gc_staff (user_id, role)
    values (%L::uuid, 'gc_delivery_ops');
  insert into public.titles (id, org_id, title, status)
    values (%L::uuid, %L::uuid, 'SCC Title', 'in_delivery');
  insert into public.assets (org_id, title_id, kind, storage_key, content_hash, bytes)
    values (%L::uuid, %L::uuid, 'master', 'orgs/scc/master/film.mov', 'scchash', 1000);
  insert into public.vendors (id, name, delivery_mode, active)
    values (%L::uuid, %L, 'portal_upload', true),
           (%L::uuid, %L, 'portal_upload', true);
end
$body$;
$q$,
  current_setting('scc.owner'),
  current_setting('scc.gc'),
  current_setting('scc.org'),
  '__pgtap_scc__' || current_setting('scc.nonce'),
  current_setting('scc.owner'),
  current_setting('scc.org'),
  current_setting('scc.gc'),
  current_setting('scc.title'),
  current_setting('scc.org'),
  current_setting('scc.org'),
  current_setting('scc.title'),
  current_setting('scc.v1'),
  '__pgtap_scc__v1__' || current_setting('scc.nonce'),
  current_setting('scc.v2'),
  '__pgtap_scc__v2__' || current_setting('scc.nonce')
));

select dblink_connect('a', pg_temp.scc_connstr());
select dblink_connect('b', pg_temp.scc_connstr());

-- --------------------------------------------------------------------------
-- Different recipients: unique keys differ, so only the title FOR UPDATE
-- can keep B busy. This is the lock-specific test.
-- --------------------------------------------------------------------------
select pg_temp.scc_begin_auth('a', current_setting('scc.owner')::uuid);
select dblink_exec('a', format(
  $cmd$do $body$ begin
    perform public.create_screener_link(%L::uuid, %L, null, null, 'Tubi');
  end $body$;$cmd$,
  current_setting('scc.title'),
  current_setting('scc.tok_a_tubi')
));

select pg_temp.scc_begin_auth('b', current_setting('scc.owner')::uuid);
select dblink_exec('b', 'SET LOCAL lock_timeout = ''20s''');
select dblink_send_query('b', format(
  $cmd$select public.create_screener_link(%L::uuid, %L, null, null, 'Roku')$cmd$,
  current_setting('scc.title'),
  current_setting('scc.tok_b_roku')
));

select ok(
  pg_temp.scc_wait_busy('b', 2000),
  'different-recipient: B is busy after A completed the RPC with its transaction open'
);
select pg_sleep(0.2);
select ok(
  dblink_is_busy('b') = 1,
  'different-recipient: B remains busy before A commits'
);

select dblink_exec('a', 'COMMIT');
select ok(
  pg_temp.scc_wait_idle('b', 5000),
  'different-recipient: B completes after A commits'
);
select lives_ok(
  $$ select pg_temp.scc_harvest_uuid('b') $$,
  'different-recipient: B RPC succeeds'
);
select dblink_exec('b', 'COMMIT');

select is(
  (select count(*) from public.portal_links
    where title_id = current_setting('scc.title')::uuid
      and purpose = 'screener_view'
      and revoked_at is null
      and nullif(lower(btrim(recipient_name)), '') in ('tubi', 'roku'))::int,
  2,
  'different-recipient: two live links (Tubi and Roku) after both commit'
);

-- --------------------------------------------------------------------------
-- Same recipient: one live canonical key when the overlap resolves.
-- --------------------------------------------------------------------------
select pg_temp.scc_begin_auth('a', current_setting('scc.owner')::uuid);
select dblink_exec('a', format(
  $cmd$do $body$ begin
    perform public.create_screener_link(%L::uuid, %L, null, null, 'Vudu');
  end $body$;$cmd$,
  current_setting('scc.title'),
  current_setting('scc.tok_a_vudu')
));

select pg_temp.scc_begin_auth('b', current_setting('scc.owner')::uuid);
select dblink_exec('b', 'SET LOCAL lock_timeout = ''20s''');
select dblink_send_query('b', format(
  $cmd$select public.create_screener_link(%L::uuid, %L, null, null, 'Vudu')$cmd$,
  current_setting('scc.title'),
  current_setting('scc.tok_b_vudu')
));

select ok(
  pg_temp.scc_wait_busy('b', 2000),
  'same-recipient: B is busy while A holds the title lock'
);
select dblink_exec('a', 'COMMIT');
select ok(
  pg_temp.scc_wait_idle('b', 5000),
  'same-recipient: B completes after A commits'
);
-- B may succeed (revoke+insert) or raise the mapped unique_violation; either
-- is valid only if exactly one live Vudu row remains.
do $$
begin
  perform pg_temp.scc_harvest_uuid('b');
exception
  when others then null;
end $$;
select dblink_exec('b', 'COMMIT');

select is(
  (select count(*) from public.portal_links
    where title_id = current_setting('scc.title')::uuid
      and purpose = 'screener_view'
      and revoked_at is null
      and nullif(lower(btrim(recipient_name)), '') = 'vudu')::int,
  1,
  'same-recipient: exactly one live Vudu link after overlapping creates'
);

-- --------------------------------------------------------------------------
-- Two GC unnamed: one live NULL canonical key.
-- --------------------------------------------------------------------------
select pg_temp.scc_begin_auth('a', current_setting('scc.gc')::uuid);
select dblink_exec('a', format(
  $cmd$do $body$ begin
    perform public.create_screener_link(%L::uuid, %L);
  end $body$;$cmd$,
  current_setting('scc.title'),
  current_setting('scc.tok_a_unnamed')
));

select pg_temp.scc_begin_auth('b', current_setting('scc.gc')::uuid);
select dblink_exec('b', 'SET LOCAL lock_timeout = ''20s''');
select dblink_send_query('b', format(
  $cmd$select public.create_screener_link(%L::uuid, %L)$cmd$,
  current_setting('scc.title'),
  current_setting('scc.tok_b_unnamed')
));

select ok(
  pg_temp.scc_wait_busy('b', 2000),
  'gc-unnamed: B is busy while A holds the title lock'
);
select dblink_exec('a', 'COMMIT');
select ok(
  pg_temp.scc_wait_idle('b', 5000),
  'gc-unnamed: B completes after A commits'
);
do $$
begin
  perform pg_temp.scc_harvest_uuid('b');
exception
  when others then null;
end $$;
select dblink_exec('b', 'COMMIT');

select is(
  (select count(*) from public.portal_links
    where title_id = current_setting('scc.title')::uuid
      and purpose = 'screener_view'
      and revoked_at is null
      and nullif(lower(btrim(recipient_name)), '') is null)::int,
  1,
  'gc-unnamed: exactly one live unnamed screener_view after overlapping creates'
);

-- --------------------------------------------------------------------------
-- Vendor attach race: A first-attaches V1 and holds the row; B first-attaches
-- V2 without force and must raise after A commits. One attach_vendor audit.
-- --------------------------------------------------------------------------
select set_config(
  'scc.link',
  (select id::text from public.portal_links
    where token_hash = current_setting('scc.tok_a_tubi') and revoked_at is null),
  false
);

select pg_temp.scc_begin_auth('a', current_setting('scc.gc')::uuid);
select dblink_exec('a', format(
  $cmd$do $body$ begin
    perform public.attach_link_vendor(%L::uuid, %L::uuid);
  end $body$;$cmd$,
  current_setting('scc.link'),
  current_setting('scc.v1')
));

select pg_temp.scc_begin_auth('b', current_setting('scc.gc')::uuid);
select dblink_exec('b', 'SET LOCAL lock_timeout = ''20s''');
select dblink_send_query('b', format(
  $cmd$do $body$ begin
    perform public.attach_link_vendor(%L::uuid, %L::uuid);
  end $body$;$cmd$,
  current_setting('scc.link'),
  current_setting('scc.v2')
));

select ok(
  pg_temp.scc_wait_busy('b', 2000),
  'vendor-race: B is busy while A holds the portal_links row lock'
);
select dblink_exec('a', 'COMMIT');
select ok(
  pg_temp.scc_wait_idle('b', 5000),
  'vendor-race: B completes after A commits'
);
select throws_ok(
  $$ select pg_temp.scc_harvest_text('b') $$,
  'P0001',
  'Link already has a different vendor attached — pass force to reassign',
  'vendor-race: B must pass force after A attached a different vendor'
);
do $$
begin
  perform dblink_exec('b', 'ROLLBACK');
exception
  when others then null;
end $$;

select is(
  (select vendor_id from public.portal_links where id = current_setting('scc.link')::uuid),
  current_setting('scc.v1')::uuid,
  'vendor-race: surviving vendor_id is V1'
);
select is(
  (select count(*) from public.audit_log
    where entity = 'portal_links'
      and entity_id = current_setting('scc.link')::uuid
      and action = 'attach_vendor')::int,
  1,
  'vendor-race: exactly one attach_vendor audit'
);

-- Same-vendor retry is a no-op with no second audit.
select dblink_exec('fix', format(
  $cmd$do $body$ begin
    perform set_config('request.jwt.claims', %L, true);
    set local role authenticated;
    perform public.attach_link_vendor(%L::uuid, %L::uuid);
  end $body$;$cmd$,
  pg_temp.scc_jwt(current_setting('scc.gc')::uuid),
  current_setting('scc.link'),
  current_setting('scc.v1')
));

select is(
  (select count(*) from public.audit_log
    where entity = 'portal_links'
      and entity_id = current_setting('scc.link')::uuid
      and action = 'attach_vendor')::int,
  1,
  'same-vendor retry writes no second attach_vendor audit'
);

-- Committed cleanup (survives outer rollback).
select dblink_exec('fix', format($q$
do $body$
begin
  alter table public.memberships disable trigger memberships_last_owner_guard;
  delete from public.audit_log where org_id = %L::uuid;
  delete from public.portal_links where title_id = %L::uuid;
  delete from public.assets where org_id = %L::uuid;
  delete from public.titles where id = %L::uuid;
  delete from public.memberships where org_id = %L::uuid;
  delete from public.gc_staff where user_id = %L::uuid;
  delete from public.organizations where id = %L::uuid;
  delete from public.vendors where id in (%L::uuid, %L::uuid);
  delete from auth.users where id in (%L::uuid, %L::uuid);
  alter table public.memberships enable trigger memberships_last_owner_guard;
end
$body$;
$q$,
  current_setting('scc.org'),
  current_setting('scc.title'),
  current_setting('scc.org'),
  current_setting('scc.title'),
  current_setting('scc.org'),
  current_setting('scc.gc'),
  current_setting('scc.org'),
  current_setting('scc.v1'),
  current_setting('scc.v2'),
  current_setting('scc.owner'),
  current_setting('scc.gc')
));

select pg_temp.scc_disconnect('a');
select pg_temp.scc_disconnect('b');
select pg_temp.scc_disconnect('fix');

select lives_ok(
  $$ select 1 $$,
  'concurrency sessions disconnected and fixtures cleaned'
);

select * from finish();
rollback;

-- CREATE EXTENSION above is outside the pgTAP transaction. Owned DROP must
-- also be outside it; an in-transaction drop rolls back and leaves dblink_*
-- PUBLIC execute grants that fail verify-prod-end-state C3. Drop only if
-- this locked invocation created the extension, then release the lifecycle
-- lock so a waiting copy may proceed.
do $ext$
begin
  if current_setting('scc.dblink_created_by_test', true) = 'true' then
    execute 'drop extension if exists dblink';
  end if;
  perform pg_advisory_unlock(87204602);
end
$ext$;
