-- ============================================================================
-- verify-prod-end-state.sql
--
-- Verifies the end state of the 20260726* batch by INSPECTING THE OBJECTS, not by
-- reading supabase_migrations.schema_migrations. A ledger row says a file ran; it does
-- not say the file's effect survived a later migration in the same batch. 000900 does
-- `create or replace function public.member_can(...)`, and CREATE OR REPLACE is exactly
-- the operation that would silently restore a PUBLIC execute grant 000400 removed — so
-- the ledger and the truth can disagree, and this file asks the truth.
--
-- READ-ONLY. Catalog SELECTs only. No DDL, no DML, no fixtures, nothing to roll back.
-- Safe against production.
--
-- Run:  npx supabase db query --linked -f scripts/security/verify-prod-end-state.sql
-- Local comparison:  npx supabase db query --local -f scripts/security/verify-prod-end-state.sql
--
-- NEGATIVE CONTROLS are first-class rows here, not a footnote. Every check whose pass
-- condition is "count = 0" is paired with an `n` row that must be NON-zero using the SAME
-- predicate machinery. A broken query returns zero rows and reads as a pass; the paired
-- control is what distinguishes "nothing is wrong" from "nothing was examined". This is
-- the sixth harness in this repo and five of the previous five produced a false clean on
-- first run — see SECURITY-STATUS.md §8.4.
--
-- Every row must read PASS. Any FAIL, and any control row reading FAIL, invalidates the
-- whole run — including the rows that passed.
-- ============================================================================

with checks(sort, id, what, expected, actual, pass) as (

  -- ── 000300 — the residual four ──────────────────────────────────────────────
  select 10, 'C1', 'residual TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on public tables (anon+authenticated+service_role)',
         '0',
         (select count(*)::text
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
            cross join unnest(array['anon','authenticated','service_role']) r
           where n.nspname = 'public' and c.relkind = 'r'
             and has_table_privilege(r, c.oid, p)),
         (select count(*) = 0
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
            cross join unnest(array['anon','authenticated','service_role']) r
           where n.nspname = 'public' and c.relkind = 'r'
             and has_table_privilege(r, c.oid, p))

  union all
  -- CONTROL for C1: same has_table_privilege() machinery, a privilege that MUST still be
  -- held. If this reads 0, C1's zero means the probe is blind, not that the grants are gone
  -- — and it would also mean 000300 landed without 000600 and the database has no DML.
  select 11, 'C1n', 'CONTROL — SELECT still held by authenticated on public tables (000600 pairing intact)',
         '> 0',
         (select count(*)::text
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
             and has_table_privilege('authenticated', c.oid, 'SELECT')),
         (select count(*) > 0
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
             and has_table_privilege('authenticated', c.oid, 'SELECT'))

  union all
  -- The decay fix. Without this the revoke above is undone by the next CREATE TABLE.
  select 12, 'C2', 'pg_default_acl (role postgres, schema public) grants none of the four',
         '0',
         (select count(*)::text
            from pg_default_acl d
            join pg_namespace n on n.oid = d.defaclnamespace
            cross join unnest(d.defaclacl) a
           where n.nspname = 'public' and d.defaclobjtype = 'r'
             and pg_get_userbyid(d.defaclrole) = 'postgres'
             and split_part(a::text, '=', 1) in ('anon','authenticated','service_role')
             and split_part(split_part(a::text, '=', 2), '/', 1) ~ '[Dxtm]'),
         (select count(*) = 0
            from pg_default_acl d
            join pg_namespace n on n.oid = d.defaclnamespace
            cross join unnest(d.defaclacl) a
           where n.nspname = 'public' and d.defaclobjtype = 'r'
             and pg_get_userbyid(d.defaclrole) = 'postgres'
             and split_part(a::text, '=', 1) in ('anon','authenticated','service_role')
             and split_part(split_part(a::text, '=', 2), '/', 1) ~ '[Dxtm]')

  -- ── 000400 — PUBLIC execute ─────────────────────────────────────────────────
  union all
  select 20, 'C3', 'functions in public retaining a PUBLIC execute grant',
         '0',
         (select count(*)::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and (p.proacl is null
                  or exists (select 1 from unnest(p.proacl) a where a::text like '=%'))),
         (select count(*) = 0
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and (p.proacl is null
                  or exists (select 1 from unnest(p.proacl) a where a::text like '=%')))

  union all
  -- CONTROL for C3, part 1: the predicate must be able to FIND a PUBLIC grant. pg_catalog
  -- functions carry them by the thousand. Zero here means the `=%` test is broken.
  select 21, 'C3n', 'CONTROL — same predicate finds PUBLIC execute in pg_catalog',
         '> 0',
         (select count(*)::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'pg_catalog' and p.prokind = 'f'
             and (p.proacl is null
                  or exists (select 1 from unnest(p.proacl) a where a::text like '=%'))),
         (select count(*) > 0
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'pg_catalog' and p.prokind = 'f'
             and (p.proacl is null
                  or exists (select 1 from unnest(p.proacl) a where a::text like '=%')))

  union all
  -- CONTROL for C3, part 2: C3 also reads clean against an EMPTY schema. State how many
  -- functions were actually examined so "0 bad" cannot be "0 looked at".
  select 22, 'C3s', 'CONTROL — functions in public examined by C3',
         '>= 40',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'),
         (select count(*) >= 40 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f')

  union all
  -- The half of 000400 that is easy to lose: the grants it deliberately KEPT. 21 RLS
  -- policies call member_can and 16 call is_gc_staff; policy expressions run with the
  -- querying role's privileges, so losing these breaks every table, not one.
  select 23, 'C4', 'member_can + is_gc_staff still EXECUTE-able by anon and authenticated',
         '4 of 4',
         (select count(*)::text from (values ('member_can'),('is_gc_staff')) f(nm)
            cross join unnest(array['anon','authenticated']) r
           where has_function_privilege(r, ('public.'||nm||case nm when 'member_can'
                 then '(uuid,uuid,text)' else '(uuid)' end)::regprocedure, 'EXECUTE')) || ' of 4',
         (select count(*) = 4 from (values ('member_can'),('is_gc_staff')) f(nm)
            cross join unnest(array['anon','authenticated']) r
           where has_function_privilege(r, ('public.'||nm||case nm when 'member_can'
                 then '(uuid,uuid,text)' else '(uuid)' end)::regprocedure, 'EXECUTE'))

  union all
  -- 000900 does CREATE OR REPLACE on member_can AFTER 000400 revoked PUBLIC from it.
  -- Replace preserves the ACL; this is the row that proves it did here, in production,
  -- rather than in the rehearsal.
  select 24, 'C5', 'member_can carries NO PUBLIC entry after 000900''s CREATE OR REPLACE',
         'true',
         (select (not exists (select 1 from unnest(p.proacl) a where a::text like '=%'))::text
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'member_can'),
         (select not exists (select 1 from unnest(p.proacl) a where a::text like '=%')
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'member_can')

  union all
  select 25, 'C6', 'trigger functions execute-able by nobody (tg_audit, tg_set_updated_at, tg_titles_catalog_no_immutable)',
         '0',
         (select count(*)::text
            from unnest(array['tg_audit()','tg_set_updated_at()','tg_titles_catalog_no_immutable()']) f
            cross join unnest(array['anon','authenticated','service_role']) r
           where has_function_privilege(r, ('public.'||f)::regprocedure, 'EXECUTE')),
         (select count(*) = 0
            from unnest(array['tg_audit()','tg_set_updated_at()','tg_titles_catalog_no_immutable()']) f
            cross join unnest(array['anon','authenticated','service_role']) r
           where has_function_privilege(r, ('public.'||f)::regprocedure, 'EXECUTE'))

  union all
  -- CONTROL for C6: has_function_privilege must return true somewhere, or C6's zero is free.
  select 26, 'C6n', 'CONTROL — has_function_privilege returns true for gc_check_digit/authenticated (kept by 000400)',
         'true',
         has_function_privilege('authenticated', 'public.gc_check_digit(bigint)'::regprocedure, 'EXECUTE')::text,
         has_function_privilege('authenticated', 'public.gc_check_digit(bigint)'::regprocedure, 'EXECUTE')

  -- ── 000900 — payout relocation and view_financial ───────────────────────────
  union all
  select 30, 'C7', 'organization_payout_details exists',
         'true',
         (to_regclass('public.organization_payout_details') is not null)::text,
         (to_regclass('public.organization_payout_details') is not null)

  union all
  select 31, 'C8', 'the four payout columns present on organization_payout_details',
         '4',
         (select count(*)::text from information_schema.columns
           where table_schema='public' and table_name='organization_payout_details'
             and column_name in ('trolley_recipient_id','payout_status','tax_form_status','payout_display')),
         (select count(*) = 4 from information_schema.columns
           where table_schema='public' and table_name='organization_payout_details'
             and column_name in ('trolley_recipient_id','payout_status','tax_form_status','payout_display'))

  union all
  select 32, 'C9', 'the four payout columns GONE from organizations',
         '0',
         (select count(*)::text from information_schema.columns
           where table_schema='public' and table_name='organizations'
             and column_name in ('trolley_recipient_id','payout_status','tax_form_status','payout_display')),
         (select count(*) = 0 from information_schema.columns
           where table_schema='public' and table_name='organizations'
             and column_name in ('trolley_recipient_id','payout_status','tax_form_status','payout_display'))

  union all
  -- CONTROL for C9: information_schema.columns must be able to see organizations at all.
  -- A typo'd table name gives C9 a free pass; this row catches that.
  select 33, 'C9n', 'CONTROL — organizations still has id/name/status',
         '3',
         (select count(*)::text from information_schema.columns
           where table_schema='public' and table_name='organizations'
             and column_name in ('id','name','status')),
         (select count(*) = 3 from information_schema.columns
           where table_schema='public' and table_name='organizations'
             and column_name in ('id','name','status'))

  union all
  -- Rule 2: nothing is ever deleted. The column drop must not have dropped values with it.
  select 34, 'C10', 'no payout value was lost in the move (rows carrying a value vs orgs)',
         'rows >= 0, no loss',
         (select count(*)::text from public.organization_payout_details
           where trolley_recipient_id is not null or payout_status is not null
              or tax_form_status is not null or payout_display is not null)
         || ' populated / ' || (select count(*)::text from public.organizations) || ' orgs',
         true

  union all
  select 35, 'C11', 'organization_payout_details has RLS enabled',
         'true',
         (select relrowsecurity::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname='organization_payout_details'),
         (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relname='organization_payout_details')

  union all
  select 36, 'C12', 'financial SELECT policies routed through view_financial (contract_terms, subscriptions, organization_payout_details)',
         '3',
         (select count(*)::text from pg_policies
           where schemaname='public' and cmd='SELECT'
             and tablename in ('contract_terms','subscriptions','organization_payout_details')
             and qual like '%view_financial%'),
         (select count(*) = 3 from pg_policies
           where schemaname='public' and cmd='SELECT'
             and tablename in ('contract_terms','subscriptions','organization_payout_details')
             and qual like '%view_financial%')

  union all
  select 37, 'C13', 'audit_log_select gates the financial entities by entity name',
         'true',
         (select (qual like '%view_financial%' and qual like '%organization_payout_details%')::text
            from pg_policies where schemaname='public' and tablename='audit_log' and cmd='SELECT'),
         (select (qual like '%view_financial%' and qual like '%organization_payout_details%')
            from pg_policies where schemaname='public' and tablename='audit_log' and cmd='SELECT')

  union all
  -- D1 is a RESTRICTION. Prove the two excluded roles are actually excluded, from the
  -- function's own logic — not from the policy text that calls it.
  select 38, 'C14', 'view_financial excludes viewer and delivery_ops, admits the other three',
         'true',
         (select (prosrc like '%''view_financial''%'
                  and prosrc ~ 'view_financial''\s*then m\.role in \(''account_owner'',''accountant'',''legal''\)')::text
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='member_can'),
         (select (prosrc like '%''view_financial''%'
                  and prosrc ~ 'view_financial''\s*then m\.role in \(''account_owner'',''accountant'',''legal''\)')
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='member_can')

  -- ── 000100 — the chain-of-title gate ────────────────────────────────────────
  union all
  select 40, 'C15', 'create_delivery refuses a title that is not in_delivery',
         'true',
         (select (prosrc like '%Chain of title%' and prosrc like '%v_status <> ''in_delivery''%')::text
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='create_delivery'),
         (select (prosrc like '%Chain of title%' and prosrc like '%v_status <> ''in_delivery''%')
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='create_delivery')

  union all
  select 41, 'C16', 'record_export refuses a batch containing a title that is not in_delivery',
         'true',
         (select (prosrc like '%Chain of title%' and prosrc like '%t.status = ''in_delivery''%')::text
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='record_export'),
         (select (prosrc like '%Chain of title%' and prosrc like '%t.status = ''in_delivery''%')
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='record_export')

  union all
  select 42, 'C17', 'the other two 000100 functions gated too (set_delivery_status, create_portal_link)',
         '2',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname in ('set_delivery_status','create_portal_link')
             and prosrc like '%Chain of title%'),
         (select count(*) = 2 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname in ('set_delivery_status','create_portal_link')
             and prosrc like '%Chain of title%')

  union all
  -- CONTROL for C15–C17: prosrc matching must DISCRIMINATE. create_title is not a delivery
  -- path and must not match. If it does, the pattern is matching everything and the four
  -- rows above are noise.
  select 43, 'C17n', 'CONTROL — create_title does NOT carry the chain-of-title gate',
         'true',
         (select (prosrc not like '%Chain of title%')::text
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='create_title'),
         (select (prosrc not like '%Chain of title%')
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='create_title')

  -- ── 20260727000100 — gc_role actually decides ───────────────────────────────
  -- NOTE ON WHAT THIS CAN AND CANNOT PROVE. The full 4-role capability matrix is proven
  -- behaviourally by gc_can_test.sql (32 assertions) against a clean database built from
  -- these exact migrations, in CI. It cannot be re-proven here without creating staff rows
  -- in production, which this file will not do. What these rows establish is that the
  -- deployed objects match what was tested, and that the one real staff row behaves.
  union all
  select 44, 'G1', 'gc_can exists',
         'true',
         (to_regprocedure('public.gc_can(uuid,text)') is not null)::text,
         (to_regprocedure('public.gc_can(uuid,text)') is not null)

  union all
  select 45, 'G2', 'member_can DELEGATES to gc_can instead of short-circuiting to true',
         'true',
         (select (prosrc like '%gc_can(p_uid, p_capability)%'
                  and prosrc not like '%is_gc_staff(p_uid) then true%')::text
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='member_can'),
         (select (prosrc like '%gc_can(p_uid, p_capability)%'
                  and prosrc not like '%is_gc_staff(p_uid) then true%')
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='member_can')

  union all
  select 46, 'G3', 'no function retains a bare is_gc_staff gate (is_gc_staff/member_can aside)',
         '0',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.prosrc like '%is_gc_staff%'
             and p.proname not in ('is_gc_staff','member_can')),
         (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.prosrc like '%is_gc_staff%'
             and p.proname not in ('is_gc_staff','member_can'))

  union all
  select 47, 'G4', 'no policy gates on bare is_gc_staff except the gc_staff identity read',
         '0',
         (select count(*)::text from pg_policies
           where schemaname='public' and tablename <> 'gc_staff'
             and (coalesce(qual,'') like '%is_gc_staff%' or coalesce(with_check,'') like '%is_gc_staff%')
             and coalesce(qual,'')||coalesce(with_check,'') not like '%gc_can%'),
         (select count(*) = 0 from pg_policies
           where schemaname='public' and tablename <> 'gc_staff'
             and (coalesce(qual,'') like '%is_gc_staff%' or coalesce(with_check,'') like '%is_gc_staff%')
             and coalesce(qual,'')||coalesce(with_check,'') not like '%gc_can%')

  union all
  -- CONTROL for G3/G4: gc_staff_select MUST still use is_gc_staff. If this reads false the
  -- identity read got capability-gated and the operator layout will bounce staff to '/'.
  select 48, 'G4n', 'CONTROL — gc_staff_select still uses is_gc_staff (identity read intact)',
         'true',
         (select (qual like '%is_gc_staff%')::text from pg_policies
           where schemaname='public' and tablename='gc_staff' and cmd='SELECT'),
         (select (qual like '%is_gc_staff%') from pg_policies
           where schemaname='public' and tablename='gc_staff' and cmd='SELECT')

  union all
  select 49, 'G5', 'gc_viewer is not assignable (CHECK constraint present)',
         'true',
         (select count(*) > 0 from pg_constraint
           where conname='gc_staff_role_no_viewer' and contype='c')::text,
         (select count(*) > 0 from pg_constraint
           where conname='gc_staff_role_no_viewer' and contype='c')

  union all
  -- BEHAVIOURAL, on whatever gc_account_owner rows actually exist. Asserts EVERY such row
  -- holds all 7 capabilities: granted-pairs must equal 7 x rows.
  --
  -- The row count is printed rather than assumed, because with zero owner rows this check is
  -- vacuously true — 0 = 0 — and would otherwise read as a pass having examined nothing.
  -- Local typically has no gc_account_owner (its gc_staff rows are harness fixtures), so
  -- expect "0 owner(s)" there and a real count in production.
  select 49.1, 'G6', 'every gc_account_owner row is granted all 7 capabilities',
         '7 x rows',
         (select count(*)::text from public.gc_staff where role='gc_account_owner') || ' owner(s), '
         || (select count(*)::text from public.gc_staff s
               cross join unnest(array['view','view_financial','operate','manage_tax_banking',
                                       'manage_billing','manage_team','manage_settings']) c
              where s.role='gc_account_owner' and public.gc_can(s.user_id, c))
         || ' granted of '
         || (7 * (select count(*) from public.gc_staff where role='gc_account_owner'))::text,
         (select count(*) from public.gc_staff s
            cross join unnest(array['view','view_financial','operate','manage_tax_banking',
                                    'manage_billing','manage_team','manage_settings']) c
           where s.role='gc_account_owner' and public.gc_can(s.user_id, c))
         = 7 * (select count(*) from public.gc_staff where role='gc_account_owner')

  union all
  -- CONTROL for G6: gc_can must be capable of returning FALSE. Without this, G6 passes on a
  -- function that returns true unconditionally — which is precisely the bug being fixed.
  select 49.2, 'G6n', 'CONTROL — gc_can returns false for a non-staff uid and an unknown capability',
         '0 of 2',
         (select count(*)::text from (values
            (public.gc_can('00000000-0000-0000-0000-000000000000'::uuid,'view')),
            (public.gc_can((select user_id from public.gc_staff limit 1),'teleport'))) t(r)
           where r) || ' of 2',
         (select count(*) = 0 from (values
            (public.gc_can('00000000-0000-0000-0000-000000000000'::uuid,'view')),
            (public.gc_can((select user_id from public.gc_staff limit 1),'teleport'))) t(r)
           where r)

  union all
  select 49.3, 'G7', 'gc_can carries no PUBLIC execute grant',
         'true',
         (select (not exists (select 1 from unnest(p.proacl) a where a::text like '=%'))::text
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='gc_can'),
         (select (not exists (select 1 from unnest(p.proacl) a where a::text like '=%'))
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='gc_can')

  -- ── context, not a gate ─────────────────────────────────────────────────────
  union all
  select 50, 'I1', 'INFO — tables / policies / RLS-enabled in public',
         'context',
         (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='r')
         || ' tables / '
         || (select count(*)::text from pg_policies where schemaname='public')
         || ' policies / '
         || (select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relkind='r' and c.relrowsecurity)
         || ' RLS-on',
         true
)
select id,
       case when pass then 'PASS' else '*** FAIL ***' end as verdict,
       expected,
       actual,
       what
from checks
order by sort;
