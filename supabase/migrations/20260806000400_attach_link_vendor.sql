-- 20260806000400_attach_link_vendor.sql
--
-- INTENT: close the loop the brief calls out. A client pitches a title to a buyer and mints a
-- screener_view link naming them ("Tubi"). The buyer watches. When the deal closes, the buyer
-- needs the MASTER — and master-download's own authorization (src/lib/master-licence.ts,
-- re-verified in supabase/migrations/20260719000600_deliveries.sql's rule-12 shape) requires
-- an active grant AND delivery for THIS LINK's vendor_id. Nothing sets vendor_id today.
-- portal_links.vendor_id has existed since 20260806000200, but no RPC ever wrote it — a
-- checked-but-never-written column, the exact anti-pattern 20260726000700 fixed for
-- portal_sessions.revoked_at. Until this migration, every buyer link's vendor_id is
-- permanently null, so the master route 403s universally and the entire post-licence half of
-- the buyer-title-page feature is unreachable.
--
-- WHY GC, NOT THE CLIENT. vendors is a GC-only roster (20260719000200: "the same list for
-- every client... RLS gates all ops on is_gc_staff"). Exposing it to every client so they could
-- pick a vendor themselves would reveal GC's whole distribution network to every rights holder
-- on the platform — a confidentiality leak, not a convenience. So this is a GC-operated action,
-- gated on gc_can(auth.uid(), 'operate') exactly like create_delivery and set_delivery_status:
-- attaching a vendor is an operational write (which platform gets the master), not a read
-- (gc_legal: "read all, write nothing" — excluded) and not client-reachable at all.
--
-- JUDGEMENT CALL 1 — REASSIGNMENT. Idempotent re-attach of the SAME vendor is a silent no-op:
-- GC re-clicking "Attach Tubi" on a link already pointed at Tubi must not raise. But attaching a
-- DIFFERENT vendor to a link that already has one is not the same act — it silently moves a
-- buyer's pitch (and, once a delivery exists, potentially the master itself) from one company to
-- another with no trace of the original attachment. Blocked by default; a caller who really
-- means it passes p_force := true. This mirrors the shape Task 5 already established for the
-- analogous problem on create_screener_link (typing an existing buyer name warns rather than
-- silently replacing, with an explicit flag to proceed) rather than inventing a new pattern.
-- Blocking-unless-forced is not the whole answer by itself, though — see the audit trigger below,
-- which is the other half: a forced reassignment is ALLOWED, but it is never silent again.
--
-- JUDGEMENT CALL 2 — DEAD LINKS. A revoked or expired screener_view link can never be resolved
-- by a buyer again (portal_resolve_screener rejects both states outright), so attaching a vendor
-- to one would set a column nobody can ever read through that link and nobody would notice was
-- wrong. Refused outright, no force override — unlike the reassignment case there is no
-- legitimate reason to want this; the fix is to mint a fresh link for that buyer, not to write
-- into a dead one.
--
-- WHY THIS DOES NOT ALSO CHECK FOR AN EXISTING GRANT/DELIVERY. It would be tempting to require
-- an active grant+delivery for (title, vendor) before allowing the attach, since that is exactly
-- what unlocks the master. Deliberately not done: attaching the vendor is how GC records WHO the
-- deal closed with, which can happen before, during, or after the delivery/grant paperwork lands
-- — GC's own workflow, not this RPC's business to sequence. The actual gate belongs, and already
-- lives, entirely at read time in the master-download route (rule 11: "enforce at the point of
-- action, never as a sweep") — this RPC only ever writes a fact, never a permission.
--
-- AUDIT. portal_links has never carried the tg_audit trigger — the same gap 20260726000700
-- closed for portal_sessions, called out there as pre-existing on this table too ("nor does
-- portal_links"). Vendor attachment is exactly the kind of write that must leave a trace (rule 5:
-- audit_log is the provenance record for manual, GC-operated actions), and a forced reassignment
-- doubly so. Rather than hand-roll an audit_log insert inside this one RPC, this migration
-- attaches the standard spine to the whole table, so every future portal_links write is covered,
-- not just this one. portal_links carries no org_id column (only title_id / delivery_id), so
-- tg_audit's `coalesce(after->>org_id, before->>org_id)` resolves to null for every row here —
-- identical to vendors' own audit rows (20260719000200: "vendors has no org_id, so tg_audit logs
-- the row with org_id = null... audit_log's select policy already shows null-org rows to
-- gc_staff only"). A client cannot see the audit trail for their own link's vendor attachment as
-- a result; that is an accepted, pre-existing shape of tg_audit on any org_id-less table, not a
-- new gap this migration introduces, and not this migration's job to redesign.
--
-- DESTRUCTIVE OPS (approved before apply): CREATE new function public.attach_link_vendor(uuid,
-- uuid, boolean) with its own grant (new signature, no overload to worry about). CREATE + attach
-- a new audit trigger (audit_portal_links, executing the existing public.tg_audit()) on
-- public.portal_links — this is the first trigger of any kind on that table, so every future
-- insert/update/delete on it starts landing in audit_log; no historical rows are backfilled (the
-- trigger only fires going forward) and no existing row is touched. No table altered, no column
-- added or dropped, no row deleted. Forward-only. To roll back: drop the trigger and drop
-- function public.attach_link_vendor(uuid, uuid, boolean) — no other object depends on either.
--
-- ============================================================================
-- 1. Audit portal_links — the gap 20260726000700 already flagged, closed here.
-- ============================================================================
drop trigger if exists audit_portal_links on public.portal_links;
create trigger audit_portal_links
  after insert or update or delete on public.portal_links
  for each row execute function public.tg_audit();

-- ============================================================================
-- 2. attach_link_vendor — GC-operate only. See header for both judgement calls.
-- ============================================================================
create or replace function public.attach_link_vendor(
  p_link_id   uuid,
  p_vendor_id uuid,
  p_force     boolean default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_purpose        public.portal_link_purpose;
  v_revoked_at     timestamptz;
  v_expires_at     timestamptz;
  v_current_vendor uuid;
  v_vendor_active  boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  -- vendors is a GC-only roster (see header) — this is an operational write, gc_legal
  -- ("read all, write nothing") is deliberately excluded by routing through gc_can rather
  -- than is_gc_staff, and a client never reaches this branch at all: member_can is not even
  -- consulted, because a client has no legitimate path to this RPC under any role.
  if not public.gc_can(auth.uid(), 'operate') then
    raise exception 'Not authorized';
  end if;

  select purpose, revoked_at, expires_at, vendor_id
    into v_purpose, v_revoked_at, v_expires_at, v_current_vendor
    from public.portal_links where id = p_link_id;
  if not found then raise exception 'Link not found'; end if;

  -- master_download links get their vendor from the delivery they were minted against
  -- (deliveries.vendor_id) and were never given a share_token a buyer could hold onto; only a
  -- screener_view (buyer pitch) link is the thing this RPC exists to complete.
  if v_purpose <> 'screener_view' then
    raise exception 'Only a buyer screener link can carry a vendor';
  end if;

  -- Judgement call 2: a dead link can never be resolved again (portal_resolve_screener
  -- rejects both states), so writing into one would be invisible and pointless. No force
  -- override — see header for why this differs from the reassignment case below.
  if v_revoked_at is not null then
    raise exception 'Link has been revoked';
  end if;
  if v_expires_at <= now() then
    raise exception 'Link has expired';
  end if;

  select active into v_vendor_active from public.vendors where id = p_vendor_id;
  if not found then raise exception 'Vendor not found'; end if;
  if not v_vendor_active then raise exception 'Vendor is not active'; end if;

  -- Judgement call 1: reassigning to a DIFFERENT vendor is blocked unless the caller explicitly
  -- forces it. Re-attaching the SAME vendor (v_current_vendor = p_vendor_id) always falls
  -- through as a no-op update — idempotent, no force required, no audit-worthy change of fact.
  if v_current_vendor is not null and v_current_vendor <> p_vendor_id and not coalesce(p_force, false) then
    raise exception 'Link already has a different vendor attached — pass force to reassign';
  end if;

  update public.portal_links set vendor_id = p_vendor_id where id = p_link_id;
end; $$;

revoke execute on function public.attach_link_vendor(uuid, uuid, boolean) from public, anon;
grant  execute on function public.attach_link_vendor(uuid, uuid, boolean) to authenticated;
