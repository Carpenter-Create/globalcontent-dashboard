-- ============================================================================
-- 20260726000800_portal_session_audit_scope.sql
--
-- INTENT: narrow what 20260726000700 audits. That migration attached the generic tg_audit
-- to portal_sessions so a revocation would not be silent. It works, but tg_audit writes
-- to_jsonb(NEW) — the WHOLE row — on every INSERT and UPDATE, and for this table that is
-- more than the audit needs and more than it should hold.
--
-- WHAT IS ACTUALLY IN THERE, from a live row:
--     { id, link_id, name, company, email, expires_at, revoked_at, created_at,
--       token_hash: "7002d46f…" }
--
-- Two problems, in order of severity.
--
-- 1. token_hash. That is the session credential — the value portal_resolve_download and
--    portal_resolve_screener look sessions up by — now copied into an append-only table
--    from which UPDATE and DELETE are revoked for every role. It is a SHA-256 of 256 bits
--    of entropy, so it is not reversible and this is not an exposure. It is simply a
--    credential artifact with zero audit value, written somewhere it can never be removed.
--    "Session created" is the signal; the token is not part of it.
--
-- 2. Recipient PII with no org. portal_sessions has no org_id, so tg_audit records
--    org_id = NULL. Of the four entities that currently produce org-less audit rows
--    (gc_staff, portal_sessions, vendors, works), portal_sessions is the ONLY one carrying
--    an external person's name, company and email — a vendor contact, a third party who
--    never agreed to anything with GC.
--
--    That widens audit row A6. There is no account-closure or data-deletion path anywhere
--    in the repo (verified: nothing deletes from audit_log, and UPDATE/DELETE are revoked
--    for both authenticated and service_role). When one is built, the obvious shape is
--    "purge this org's rows", filtered on org_id — and these rows have no org_id, so an
--    org-scoped purge would miss them by construction. They are unreachable by the very
--    query a deletion routine would write.
--
-- THE FIX: audit the transition, not the row.
--   * UPDATE only. Session CREATION is already recorded in portal_access_events
--     ('otp_verified', written by verify-otp with the same email), so auditing the insert
--     duplicates an event that already exists in the purpose-built table.
--   * Redact token_hash outright.
--   * Keep email/name/company ONLY on the revocation transition, where an incident
--     responder genuinely needs to know which recipient was cut off. That is a deliberate
--     retention of PII for a stated purpose, not an accident of to_jsonb().
--
-- The rows 20260726000700 already wrote are left alone. audit_log is append-only by
-- design, so cleaning them would require the break-glass owner path; they are two rows on
-- local, and on production they are session-creation records that fall inside the same
-- purpose. Noted rather than quietly rewritten.
--
-- DESTRUCTIVE OPS: replaces a trigger on public.portal_sessions. No data change, no policy
-- change, no grant change. Forward-only and idempotent.
-- ============================================================================

create or replace function public.tg_audit_portal_session()
  returns trigger
  language plpgsql security definer set search_path = public
as $$
declare v_before jsonb; v_after jsonb;
begin
  -- Only the revocation transition is interesting. Everything else about a session's life
  -- is already in portal_access_events, which is purpose-built and org-reachable via its
  -- link. Nothing to record here otherwise.
  if old.revoked_at is not distinct from new.revoked_at then
    return new;
  end if;

  -- Redact the credential. Keep the recipient identity: during an incident "which address
  -- lost access, and when" is the question being asked.
  v_before := to_jsonb(old) - 'token_hash';
  v_after  := to_jsonb(new) - 'token_hash';

  insert into public.audit_log (org_id, entity, entity_id, action, actor, before, after)
  values (null, 'portal_sessions', new.id, 'revoke', auth.uid(), v_before, v_after);

  return new;
end;
$$;

revoke execute on function public.tg_audit_portal_session() from public, anon, authenticated, service_role;

-- Replace the generic trigger with the scoped one. Was: AFTER INSERT OR UPDATE OR DELETE
-- executing tg_audit; now UPDATE only, executing the redacting function above.
drop trigger if exists audit_portal_sessions on public.portal_sessions;
create trigger audit_portal_sessions
  after update on public.portal_sessions
  for each row execute function public.tg_audit_portal_session();

-- ----------------------------------------------------------------------------
-- OPEN, and deliberately not solved here — audit row A6.
--
-- There is still no account-closure or data-deletion path in this application, and
-- audit_log is append-only with UPDATE/DELETE revoked for every role. When A6 is built it
-- has to answer, explicitly:
--
--   * how it reaches org-less audit rows (gc_staff, portal_sessions, vendors, works),
--     since an org_id filter will not find them;
--   * whether a vendor contact who asks for erasure can be served at all, given that the
--     rows naming them are in a table designed to be immutable;
--   * and what the retention period for portal recipient identity actually is, because
--     "forever" is the current answer by default rather than by decision.
--
-- This migration reduces how much lands there. It does not give you a way to get it out.
-- ----------------------------------------------------------------------------
