-- ============================================================================
-- 20260718000800_title_metadata_revoke_direct_writes.sql
--
-- Defense in depth: revoke INSERT/UPDATE/DELETE on title_metadata from
-- authenticated + service_role so a direct client write hard-fails (42501)
-- instead of silently affecting zero rows. set_title_metadata is SECURITY
-- DEFINER (runs as the table owner), so the RPC upsert is unaffected — the owner
-- retains all privileges. Matches the assets/rights_grants convention (the
-- original 000700 omitted this on a flawed "the RPC needs UPDATE" assumption).
-- Forward-only.
-- ============================================================================

revoke insert, update, delete on public.title_metadata from authenticated, service_role;
