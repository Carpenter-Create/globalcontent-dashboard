-- ============================================================================
-- 20260726000300_revoke_residual_table_grants.sql
--
-- INTENT: remove four privileges that no role in this application needs and that no
-- repository migration ever granted — TRUNCATE, REFERENCES, TRIGGER, MAINTAIN.
--
-- WHY IT MATTERS: PostgreSQL does not apply row-level security to TRUNCATE. The schema
-- has 34 policies and no DELETE policy on any table, and audit_log / source_documents /
-- source_records / contract_assents each have UPDATE and DELETE explicitly revoked as
-- append-only legal records — and every one of them is still truncatable at the
-- privilege level. Deletion was locked down carefully; truncation was left open.
--
-- WHERE IT CAME FROM: not from here. Searching all 31 prior migrations for `grant all`
-- or any grant of these four returns nothing — the migrations only ever revoke. The
-- source is pg_default_acl, Supabase's bootstrap, which registers
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role
-- twice, once owned by `postgres` and once by `supabase_admin`. Every CREATE TABLE in
-- every migration therefore arrives with arwdDxtm and the migration subtracts from it.
--
-- WHY THE PER-TABLE REVOKE IS NOT ENOUGH (verified, not assumed): creating a table in a
-- transaction and inspecting it showed a brand-new table arriving with
-- SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN for `authenticated`.
-- A one-time revoke across 26 tables decays the moment table 27 is created. The same
-- probe re-run after the ALTER DEFAULT PRIVILEGES below showed the new table arriving
-- with SELECT,INSERT,UPDATE,DELETE only. Both probes were rolled back.
--
-- REACHABILITY, stated plainly: none of this is exercisable through PostgREST, which
-- has no DDL and no TRUNCATE verb. A browser client holds a JWT to PostgREST, not a
-- Postgres connection as `authenticated`. This is a least-privilege defect that
-- contradicts the stated intent of golden rule 5, not an open door. It becomes live the
-- moment anything connects directly as that role.
--
-- ⚠ ORDERING DEPENDENCY — THIS FILE MUST NOT BE APPLIED WITHOUT 20260726000600.
--
--   THIS FILE ALONE, on a current Supabase image  ->  a database with NO DML.
--     Not one of the 31 prior migrations issues a GRANT; every table privilege is inherited
--     from pg_default_acl. On a current image that default has been narrowed to exactly
--     REFERENCES, TRIGGER and the wipe verb — i.e. the four this migration revokes are the
--     ONLY privileges `authenticated` has. Revoke them and stop, and all 26 tables have zero
--     SELECT/INSERT/UPDATE/DELETE. Every read 403s. SECURITY DEFINER RPCs keep running as
--     owner, so writes appear to succeed while nothing can be read back — which presents as
--     an application bug rather than a permissions one.
--
--   20260726000600 states the DML grants explicitly and is what makes this safe. Verified on
--   a throwaway rebuild (CLI 2.109.1, 31 migrations from scratch): 000300 then 000600 leaves
--   the residuals cleared AND all 26 tables readable.
--
--   Apply order: 20260726000300, then 20260726000600. Never one without the other.
--
-- DESTRUCTIVE OPS: REVOKE across all tables in public, and ALTER DEFAULT PRIVILEGES.
-- Nothing is dropped and no data changes. Forward-only and idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Stop the bleed first. Without this the rest decays on the next CREATE TABLE.
--
--    Scoped `FOR ROLE postgres` because that is the role migrations run as, and a
--    default-ACL entry only applies to objects created by its own grantor role.
--    Verified: the probe above created its table as `postgres` and the FOR ROLE
--    postgres form alone was sufficient.
--
--    The `supabase_admin` entry is deliberately NOT touched. `postgres` is not a member
--    of `supabase_admin` and attempting it fails with "permission denied to change
--    default privileges" — tried, confirmed. It only applies to tables created BY
--    supabase_admin, which no migration in this repo does. If Supabase support or a
--    platform operation ever creates a table in `public` as supabase_admin, that table
--    will arrive with the full grant and needs a manual revoke. Noted rather than
--    silently unhandled.
-- ----------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from anon, authenticated;

-- service_role holds the same four. It is the trusted server identity (the Stripe
-- webhook and the six portal routes), and nothing in the app truncates, defines a
-- trigger, creates a foreign key, or vacuums. Removing them costs nothing and takes
-- the RLS-immune verb away from the one key that already bypasses RLS.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger, maintain on tables from service_role;

-- ----------------------------------------------------------------------------
-- 2. Now clear the 26 existing tables. Schema-wide rather than a hand-written list,
--    so a table added between writing and applying this cannot be missed.
-- ----------------------------------------------------------------------------
revoke truncate, references, trigger, maintain
  on all tables in schema public
  from anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Prove it, at apply time, rather than trusting the statements above.
--    Fails the migration loudly if any table still carries one of the four.
-- ----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(format('%s(%s)', c.relname, p), ', ')
    into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
  cross join unnest(array['anon','authenticated','service_role']) r
  where n.nspname = 'public' and c.relkind = 'r'
    and has_table_privilege(r, c.oid, p);

  if v_bad is not null then
    raise exception 'residual grants still present after revoke: %', v_bad;
  end if;

  raise notice 'residual grants cleared on all tables in public';
end $$;

-- ----------------------------------------------------------------------------
-- NOT CHANGED, on purpose: SELECT/INSERT/UPDATE/DELETE are left exactly as the
-- existing migrations set them. RLS is the authorization layer and those verbs are
-- what the policies gate. This migration only removes the four that no policy can
-- reach and no code path uses.
-- ----------------------------------------------------------------------------
