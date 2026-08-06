-- 20260806000100_asset_kind_add_trailer.sql
-- INTENT: add 'trailer' to asset_kind. Clients deliver a promotional trailer alongside
-- the master; it was previously being filed as a master, which both mislabels it and
-- (since 111fbbe) tags it for Glacier — a trailer must stay instantly servable.
-- Isolated migration so the new enum value is committed before any later migration/DML
-- uses it (same reason as 20260720000200_screener_asset_kind).
-- DESTRUCTIVE OPS (approved before apply): alter type add value. Forward-only + idempotent.
alter type public.asset_kind add value if not exists 'trailer';
