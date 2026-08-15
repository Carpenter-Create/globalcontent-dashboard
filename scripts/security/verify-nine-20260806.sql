-- ============================================================================
-- verify-nine-20260806.sql
--
-- Catalog-only verification of the terminal state of the nine unapplied
-- 20260806–20260808 migrations after they have been applied to the database
-- under test (local reset, or production after founder apply).
--
-- READ-ONLY. Catalog SELECTs only. No application/business rows, identifiers,
-- tokens, names, emails, audit payloads, or secrets are read or printed.
--
-- Local:  supabase db query --local -f scripts/security/verify-nine-20260806.sql
-- Do not run --linked from an agent.
--
-- Every row must read PASS.
-- ============================================================================

with checks(sort, id, what, expected, actual, pass) as (

  select 10, 'N1', 'asset_kind includes trailer',
         'true',
         (select exists (
            select 1 from pg_enum e
            join pg_type t on t.oid = e.enumtypid
            join pg_namespace n on n.oid = t.typnamespace
            where n.nspname = 'public' and t.typname = 'asset_kind' and e.enumlabel = 'trailer'
          ))::text,
         exists (
            select 1 from pg_enum e
            join pg_type t on t.oid = e.enumtypid
            join pg_namespace n on n.oid = t.typnamespace
            where n.nspname = 'public' and t.typname = 'asset_kind' and e.enumlabel = 'trailer'
          )

  union all
  select 20, 'N2', 'portal_links.vendor_id and recipient_name exist',
         '2',
         (select count(*)::text from information_schema.columns
           where table_schema = 'public' and table_name = 'portal_links'
             and column_name in ('vendor_id', 'recipient_name')),
         (select count(*) = 2 from information_schema.columns
           where table_schema = 'public' and table_name = 'portal_links'
             and column_name in ('vendor_id', 'recipient_name'))

  union all
  select 30, 'N3', 'active screener recipient unique index is unique + NULLS NOT DISTINCT',
         'true',
         (select (i.indisunique and i.indnullsnotdistinct)::text
            from pg_index i
            join pg_class c on c.oid = i.indexrelid
           where c.relname = 'portal_links_active_screener_recipient_uidx'),
         (select i.indisunique and i.indnullsnotdistinct
            from pg_index i
            join pg_class c on c.oid = i.indexrelid
           where c.relname = 'portal_links_active_screener_recipient_uidx')

  union all
  select 31, 'N3k', 'unique index expression is the canonical recipient key',
         'true',
         (select (pg_get_expr(i.indexprs, i.indrelid)
                    ilike '%nullif(lower(btrim(recipient_name)), ''''%')::text
            from pg_index i
            join pg_class c on c.oid = i.indexrelid
           where c.relname = 'portal_links_active_screener_recipient_uidx'),
         (select pg_get_expr(i.indexprs, i.indrelid)
                   ilike '%nullif(lower(btrim(recipient_name)), ''''%'
            from pg_index i
            join pg_class c on c.oid = i.indexrelid
           where c.relname = 'portal_links_active_screener_recipient_uidx')

  union all
  select 32, 'N3p', 'unique index predicate covers live screener_view only',
         'true',
         (select (pg_get_expr(i.indpred, i.indrelid) like '%screener_view%'
                  and pg_get_expr(i.indpred, i.indrelid) like '%revoked_at%')::text
            from pg_index i
            join pg_class c on c.oid = i.indexrelid
           where c.relname = 'portal_links_active_screener_recipient_uidx'),
         (select pg_get_expr(i.indpred, i.indrelid) like '%screener_view%'
             and pg_get_expr(i.indpred, i.indrelid) like '%revoked_at%'
            from pg_index i
            join pg_class c on c.oid = i.indexrelid
           where c.relname = 'portal_links_active_screener_recipient_uidx')

  union all
  select 40, 'N4', 'create_screener_link 5-arg exists; 4-arg is gone',
         'true',
         ((to_regprocedure('public.create_screener_link(uuid,text,timestamptz,text,text)') is not null
           and to_regprocedure('public.create_screener_link(uuid,text,timestamptz,text)') is null)::text),
         (to_regprocedure('public.create_screener_link(uuid,text,timestamptz,text,text)') is not null
          and to_regprocedure('public.create_screener_link(uuid,text,timestamptz,text)') is null)

  union all
  select 41, 'N4a', 'terminal create_screener_link authorizes via member_can operate',
         'true',
         (select (p.prosrc like '%member_can(auth.uid(), v_org, ''operate'')%'
                  and p.prosrc like '%Not authorized%')::text
            from pg_proc p
           where p.oid = to_regprocedure('public.create_screener_link(uuid,text,timestamptz,text,text)')),
         (select p.prosrc like '%member_can(auth.uid(), v_org, ''operate'')%'
             and p.prosrc like '%Not authorized%'
            from pg_proc p
           where p.oid = to_regprocedure('public.create_screener_link(uuid,text,timestamptz,text,text)'))

  union all
  select 42, 'N4b', 'terminal create_screener_link classifies staff; does not gate on caller is_gc_staff',
         'true',
         (select (
                    p.prosrc like '%v_is_gc := public.is_gc_staff(auth.uid());%'
                    and not (
                      regexp_replace(
                        p.prosrc,
                        '[A-Za-z_][A-Za-z0-9_]*\s*:=\s*(public\.)?is_gc_staff\s*\(\s*auth\.uid\s*\(\s*\)\s*\)\s*;',
                        '',
                        'g'
                      ) ~* 'is_gc_staff\s*\(\s*(auth\.uid\s*\(\s*\)|p_uid|v_uid)\s*\)'
                    )
                  )::text
            from pg_proc p
           where p.oid = to_regprocedure('public.create_screener_link(uuid,text,timestamptz,text,text)')),
         (select p.prosrc like '%v_is_gc := public.is_gc_staff(auth.uid());%'
             and not (
               regexp_replace(
                 p.prosrc,
                 '[A-Za-z_][A-Za-z0-9_]*\s*:=\s*(public\.)?is_gc_staff\s*\(\s*auth\.uid\s*\(\s*\)\s*\)\s*;',
                 '',
                 'g'
               ) ~* 'is_gc_staff\s*\(\s*(auth\.uid\s*\(\s*\)|p_uid|v_uid)\s*\)'
             )
            from pg_proc p
           where p.oid = to_regprocedure('public.create_screener_link(uuid,text,timestamptz,text,text)'))

  union all
  select 43, 'N4c', 'terminal create_screener_link locks the title, uses canonical key, requires buyer name, maps unique_violation',
         'true',
         (select (p.prosrc like '%for update%'
                  and p.prosrc like '%nullif(lower(btrim(recipient_name)), '''')%'
                  and p.prosrc like '%A buyer name is required%'
                  and p.prosrc like '%unique_violation%')::text
            from pg_proc p
           where p.oid = to_regprocedure('public.create_screener_link(uuid,text,timestamptz,text,text)')),
         (select p.prosrc like '%for update%'
             and p.prosrc like '%nullif(lower(btrim(recipient_name)), '''')%'
             and p.prosrc like '%A buyer name is required%'
             and p.prosrc like '%unique_violation%'
            from pg_proc p
           where p.oid = to_regprocedure('public.create_screener_link(uuid,text,timestamptz,text,text)'))

  union all
  select 50, 'N5', 'attach_link_vendor locks portal_links and defaults p_vendor_id to null',
         'true',
         (select (p.prosrc ilike '%for update%'
                  and pg_get_functiondef(p.oid) ilike '%p_vendor_id%default%null%')::text
            from pg_proc p
           where p.oid = to_regprocedure('public.attach_link_vendor(uuid,uuid,boolean)')),
         (select p.prosrc ilike '%for update%'
             and pg_get_functiondef(p.oid) ilike '%p_vendor_id%default%null%'
            from pg_proc p
           where p.oid = to_regprocedure('public.attach_link_vendor(uuid,uuid,boolean)'))

  union all
  select 51, 'N5g', 'title_vendor_licensed is not executable by authenticated',
         'true',
         (select (not has_function_privilege(
                    'authenticated',
                    'public.title_vendor_licensed(uuid,uuid)',
                    'execute'
                  ))::text),
         (not has_function_privilege(
            'authenticated',
            'public.title_vendor_licensed(uuid,uuid)',
            'execute'
          ))

  union all
  select 60, 'N6', 'portal_links_select hides GC-authored unnamed screener links from clients',
         'true',
         (select (
                    coalesce(qual, '') ilike '%gc_can%'
                    and coalesce(qual, '') ilike '%member_can%'
                    and coalesce(qual, '') ilike '%recipient_name is null%'
                    and coalesce(qual, '') ilike '%is_gc_staff(created_by)%'
                  )::text
            from pg_policies
           where schemaname = 'public'
             and tablename = 'portal_links'
             and policyname = 'portal_links_select'),
         (select coalesce(qual, '') ilike '%gc_can%'
             and coalesce(qual, '') ilike '%member_can%'
             and coalesce(qual, '') ilike '%recipient_name is null%'
             and coalesce(qual, '') ilike '%is_gc_staff(created_by)%'
            from pg_policies
           where schemaname = 'public'
             and tablename = 'portal_links'
             and policyname = 'portal_links_select')

  union all
  select 70, 'N7', 'transcode_jobs table exists with RLS',
         'true',
         (select (c.relrowsecurity)::text
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'transcode_jobs'),
         (select c.relrowsecurity
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname = 'transcode_jobs')

  union all
  select 80, 'N8', 'portal_resolve_screener returns asset_kind',
         'true',
         (select ('asset_kind' = any(p.proargnames))::text
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'portal_resolve_screener'),
         (select 'asset_kind' = any(p.proargnames)
            from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'portal_resolve_screener')

  union all
  select 90, 'N9', 'create_screener_link 5-arg is granted to authenticated only (not anon/public)',
         'true',
         (select (
                    has_function_privilege(
                      'authenticated',
                      'public.create_screener_link(uuid,text,timestamptz,text,text)',
                      'execute'
                    )
                    and not has_function_privilege(
                      'anon',
                      'public.create_screener_link(uuid,text,timestamptz,text,text)',
                      'execute'
                    )
                  )::text),
         (has_function_privilege(
            'authenticated',
            'public.create_screener_link(uuid,text,timestamptz,text,text)',
            'execute'
          )
          and not has_function_privilege(
            'anon',
            'public.create_screener_link(uuid,text,timestamptz,text,text)',
            'execute'
          ))

  union all
  select 100, 'N0n', 'CONTROL — unique index name is present in pg_class (probe not blind)',
         '1',
         (select count(*)::text from pg_class where relname = 'portal_links_active_screener_recipient_uidx'),
         (select count(*) = 1 from pg_class where relname = 'portal_links_active_screener_recipient_uidx')
)
select id,
       case when pass then 'PASS' else '*** FAIL ***' end as verdict,
       expected,
       actual,
       what
from checks
order by sort;
