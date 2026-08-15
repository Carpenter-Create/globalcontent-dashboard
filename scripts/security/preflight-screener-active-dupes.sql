-- ============================================================================
-- preflight-screener-active-dupes.sql
--
-- SELECT-only production preflight for portal_links_active_screener_recipient_uidx.
-- Existing live screener_view rows become canonical key NULL once recipient_name
-- is added. Multiple live rows per title will make CREATE UNIQUE INDEX fail.
--
-- Reports aggregates only:
--   conflicting_title_count
--   conflicting_active_row_count
--   max_active_per_title
--
-- Does not select title identifiers, tokens, names, emails, or audit payloads.
-- Does not modify, revoke, or delete any row.
--
-- Privileged read (not drift_reader). Founder-executed only against production.
--
-- If conflicting_title_count > 0: do not apply the nine. Founder chooses
-- remediation SQL (shown and approved separately), then re-runs this file.
--
-- ---------------------------------------------------------------------------
-- OPTIONAL title-UUID listing — NOT executable in this file.
-- Requires a separate, explicit founder authorization before anyone runs it.
-- Never include share_token, token_hash, recipient_name, or other PII.
--
-- -- FOUNDER-AUTHORIZED IDENTIFIERS ONLY. Do not run without that approval.
-- -- select title_id, count(*)::int as active_screener_view_rows
-- --   from public.portal_links
-- --  where purpose = 'screener_view' and revoked_at is null
-- --  group by title_id
-- -- having count(*) > 1
-- --  order by count(*) desc;
-- ---------------------------------------------------------------------------

select
  count(*)::int                         as conflicting_title_count,
  coalesce(sum(n), 0)::int              as conflicting_active_row_count,
  coalesce(max(n), 0)::int              as max_active_per_title
from (
  select title_id, count(*) as n
    from public.portal_links
   where purpose = 'screener_view'
     and revoked_at is null
   group by title_id
  having count(*) > 1
) s;
