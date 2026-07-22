-- 20260722000100_asset_kind_add_poster_banner.sql
-- INTENT: "Artwork" becomes a category of two graphics — poster (vertical) + banner
-- (horizontal). ADD both enum values (rather than RENAME the legacy 'artwork') so a
-- deploy is safe: the currently-deployed code reads kind='artwork', and if that value
-- were renamed away it would raise an invalid-enum error mid-deploy. Keeping 'artwork'
-- valid means old code simply finds 0 rows after the backfill (next migration) — never a
-- crash. Isolated ADD VALUE: Postgres can't USE a newly added enum value in the same
-- transaction it was added, so the backfill lives in 20260722000200.
alter type public.asset_kind add value if not exists 'poster';
alter type public.asset_kind add value if not exists 'banner';
