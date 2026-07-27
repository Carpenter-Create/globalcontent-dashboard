-- ============================================================================
-- compare-schema-digest.sql
--
-- Emits a fixed set of counts and md5 digests describing `public`. Run it against two
-- databases and diff the output: identical digests mean identical schema, privileges,
-- policies and row counts. This is the count-by-count leg of dump verification, done as
-- digests so that a one-byte difference in a single grant string cannot hide inside a
-- matching count.
--
-- READ-ONLY. Catalog reads plus a count(*) per table.
--
-- Production:   npx supabase db query --linked -f scripts/security/compare-schema-digest.sql
-- Restored dump (throwaway db inside the local container):
--   docker cp scripts/security/compare-schema-digest.sql supabase_db_globalcontent-dashboard:/tmp/cmp.sql
--   docker exec supabase_db_globalcontent-dashboard psql -U postgres -d <throwaway> -f /tmp/cmp.sql
--
-- WHAT DOES NOT TRAVEL, and must not be read as a mismatch:
--   * `auth`, `storage` and other platform schemas — a restore outside the platform cannot
--     SET ROLE supabase_auth_admin, so those objects are skipped with errors. This file
--     deliberately scopes to `public`, which is the schema the migrations own.
--   * pg_default_acl — ALTER DEFAULT PRIVILEGES is refused to a non-superuser on restore.
--     The `default_acl_*` rows below WILL differ, and that difference is the restore
--     environment, not the dump. Compare them for information, not as a gate.
-- ============================================================================

select 'tables' as k,
       (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relkind='r') as v
union all
select 'policies',
       (select count(*)::text from pg_policies where schemaname='public')
union all
select 'rls_enabled',
       (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relkind='r' and c.relrowsecurity)
union all
select 'functions',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public')
union all
select 'triggers',
       (select count(*)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid
         join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and not t.tgisinternal)
union all
select 'indexes',
       (select count(*)::text from pg_index i join pg_class c on c.oid=i.indrelid
         join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')
union all
select 'constraints',
       (select count(*)::text from pg_constraint c join pg_namespace n on n.oid=c.connamespace
         where n.nspname='public')
-- THE GRANT STRING. The whole point of this file: a table can be present, policied and
-- correctly shaped while carrying the wrong ACL.
union all
select 'table_acl_md5',
       (select md5(string_agg(c.relname||'='||coalesce(array_to_string(c.relacl,','),'~null~'),
                              '|' order by c.relname))
          from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relkind='r')
union all
select 'function_acl_md5',
       (select md5(string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')='
                              ||coalesce(array_to_string(p.proacl,','),'~null~'),
                              '|' order by p.proname, pg_get_function_identity_arguments(p.oid)))
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
union all
select 'policy_md5',
       (select md5(string_agg(tablename||'.'||policyname||'|'||cmd||'|'
                              ||coalesce(array_to_string(roles,','),'')||'|'
                              ||coalesce(qual,'')||'|'||coalesce(with_check,''),
                              E'\n' order by tablename, policyname))
          from pg_policies where schemaname='public')
union all
select 'column_md5',
       (select md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable
                              ||':'||coalesce(column_default,'~'),
                              '|' order by table_name, column_name))
          from information_schema.columns where table_schema='public')
union all
select 'function_src_md5',
       (select md5(string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')='||p.prosrc,
                              E'\n' order by p.proname, pg_get_function_identity_arguments(p.oid)))
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')
-- Data, not just shape. A dump that restores an empty catalog passes every check above.
union all
select 'rowcount_md5',
       (select md5(string_agg(relname||':'||cnt::text, '|' order by relname)) from (
          select c.relname,
                 (xpath('/row/c/text()',
                        query_to_xml(format('select count(*) as c from public.%I', c.relname),
                                     false, true, '')))[1]::text::bigint as cnt
            from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='r') t)
union all
select 'total_rows',
       (select sum(cnt)::text from (
          select (xpath('/row/c/text()',
                        query_to_xml(format('select count(*) as c from public.%I', c.relname),
                                     false, true, '')))[1]::text::bigint as cnt
            from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='r') t)
union all
select 'ledger_rows',
       (select count(*)::text from supabase_migrations.schema_migrations)
union all
select 'ledger_max',
       (select max(version) from supabase_migrations.schema_migrations)
-- Informational only — see the header. Expected to differ on a restored copy.
union all
select 'default_acl_entries',
       (select count(*)::text from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace
         where n.nspname='public')
order by 1;
