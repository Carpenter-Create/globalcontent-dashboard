-- 20260720000200_screener_asset_kind.sql
-- INTENT: add 'screener' to asset_kind (Portal-2). Isolated migration so the new
-- enum value is committed before any later migration/DML uses it.
-- DESTRUCTIVE OPS (approved before apply): alter type add value. Forward-only + idempotent.
alter type public.asset_kind add value if not exists 'screener';
