-- 20260720000500_restore_event.sql
-- INTENT: add 'restore_requested' to portal_event (Portal-3 Glacier restore provenance).
-- Logged (append-only, via portal_access_events) when a portal access auto-initiates a
-- Standard Glacier restore of an archived master. Isolated migration (own file) so the new
-- enum value commits before any app use.
-- DESTRUCTIVE OPS (approved before apply): alter type add value. Forward-only + idempotent.
alter type public.portal_event add value if not exists 'restore_requested';
