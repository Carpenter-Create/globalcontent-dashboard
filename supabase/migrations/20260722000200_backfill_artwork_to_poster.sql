-- 20260722000200_backfill_artwork_to_poster.sql
-- INTENT: the legacy generic 'artwork' has only ever meant the vertical poster → relabel
-- existing rows to 'poster' so they keep displaying under the new model. Separate from the
-- ADD VALUE migration because a newly added enum value can't be USED in the same txn it was
-- added. 'artwork' remains a valid (now-unused) enum value — Postgres can't drop enum
-- values, and keeping it costs nothing.
update public.assets set kind = 'poster' where kind = 'artwork';
