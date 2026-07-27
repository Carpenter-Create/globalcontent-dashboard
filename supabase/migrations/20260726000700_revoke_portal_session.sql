-- ============================================================================
-- 20260726000700_revoke_portal_session.sql
--
-- INTENT: resolve D3. portal_sessions.revoked_at has existed since the portal gate
-- (20260720000100) and is checked on every resolve — portal_resolve_download and
-- portal_resolve_screener both filter `revoked_at is null` — but NOTHING has ever written
-- it. The only two writers of a revoked_at column in the whole repo target portal_links.
-- A checked-but-never-written column is worse than an absent one: the next person to read
-- the resolver concludes the capability exists.
--
-- WHY THIS IS NOT A SECOND DOOR TO THE SAME ROOM. Link revocation already exists
-- (revoke_portal_link, 20260720000100:142), so the question was whether per-session
-- revocation adds anything. It does, because a portal link is NOT one-per-recipient:
--
--   * portal_links has no email or recipient column at all — the link is not bound to a person.
--   * portal_otps and portal_sessions each carry their OWN email, per row.
--   * there is no unique constraint tying a link to one email or one session.
--   * /api/portal/request-otp takes the address from the REQUEST BODY — "sends real email
--     to a self-supplied address" — so whoever holds the URL picks who gets the code.
--   * PORTAL.otpPerLinkPerHour exists specifically to bound "one link across all emails",
--     which only makes sense for a one-to-many link.
--
-- Confirmed by execution rather than by reading: three live sessions were minted on a
-- single link from three different addresses, all three resolved independently, and
-- revoking the LINK cut off all three at once.
--
-- So the two controls are different instruments. Revoking the link is the hammer — it ends
-- the delivery for every recipient, including the ones doing nothing wrong. Revoking a
-- session is the scalpel: one leaked cookie dies, the legitimate vendor contacts keep
-- working. During an incident that difference is the difference between containing a leak
-- and halting a delivery.
--
-- AUDIT: portal_sessions carries no trigger today (nor does portal_links), so a revocation
-- would leave no trace. This migration attaches the existing tg_audit spine so the who/when
-- lands in audit_log — the append-only record that is already the provenance store for
-- manual delivery actions (golden rule 5). Session rows carry no client PII beyond the
-- recipient's own name/company/email, which audit_log already holds for other entities.
--
-- NOT DONE HERE: a 'session_revoked' value on the portal_event enum. Postgres cannot use a
-- newly added enum value in the same transaction that adds it, so that needs its own
-- migration; audit_log covers the requirement without one.
--
-- DESTRUCTIVE OPS: creates a function and an audit trigger on public.portal_sessions.
-- No data changes, no policy changes, no grant changes. Forward-only and idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Audit the table, so a revocation is recorded rather than silent.
-- ----------------------------------------------------------------------------
drop trigger if exists audit_portal_sessions on public.portal_sessions;
create trigger audit_portal_sessions
  after insert or update or delete on public.portal_sessions
  for each row execute function public.tg_audit();

-- ----------------------------------------------------------------------------
-- 2. revoke_portal_session — GC-only, idempotent, single session.
--
--    Deliberately single-session only. A revoke-all-for-this-link variant would duplicate
--    revoke_portal_link, which already achieves that by cutting the link itself.
--
--    coalesce(revoked_at, now()) so re-revoking is a no-op that preserves the ORIGINAL
--    revocation time — the same shape revoke_portal_link uses (20260720000100:147). During
--    an incident the first timestamp is the one that matters.
-- ----------------------------------------------------------------------------
create or replace function public.revoke_portal_session(p_session_id uuid)
  returns void
  language plpgsql security definer set search_path = public
as $$
declare v_found uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;

  update public.portal_sessions
     set revoked_at = coalesce(revoked_at, now())
   where id = p_session_id
  returning id into v_found;

  if v_found is null then raise exception 'Session not found'; end if;
end;
$$;

revoke execute on function public.revoke_portal_session(uuid) from public, anon;
grant  execute on function public.revoke_portal_session(uuid) to authenticated;
