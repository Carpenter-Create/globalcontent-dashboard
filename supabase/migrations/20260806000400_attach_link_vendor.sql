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
-- JUDGEMENT CALL 1 — REASSIGNMENT AND FIRST ATTACH. Idempotent re-attach of the SAME vendor is
-- a silent no-op: GC re-clicking "Attach Tubi" on a link already pointed at Tubi must not raise.
-- Two OTHER transitions are consequential enough to require an explicit p_force, and fix round 1
-- corrected which ones:
--   (a) Reassigning to a DIFFERENT vendor than the one already attached — moves a buyer's pitch
--       to another company with no trace, unless forced.
--   (b) The FIRST attach (null -> vendor), when that exact (title, vendor) pair already has an
--       active grant and delivery on record. This is the higher-consequence case, not (a): if
--       the delivery/grant paperwork is already in place — the normal state at deal close, which
--       is the whole reason GC is doing this — one unguarded call makes the unwatermarked master
--       downloadable immediately (master-download re-resolves licensing from this link's
--       vendor_id on every request). The original version of this migration guarded only (a);
--       review correctly called that backwards. public.title_vendor_licensed(...) below answers
--       "would this pair release the master right now", re-derived at call time rather than
--       trusted from any cached state.
-- Both mirror the shape Task 5 already established for the analogous problem on
-- create_screener_link (typing an existing buyer name warns rather than silently replacing, with
-- an explicit flag to proceed) rather than inventing a new pattern.
--
-- JUDGEMENT CALL 2 — DEAD LINKS. A revoked or expired screener_view link can never be resolved
-- by a buyer again (portal_resolve_screener rejects both states outright), so attaching a vendor
-- to one would set a column nobody can ever read through that link and nobody would notice was
-- wrong. Refused outright, no force override, on BOTH the attach and detach paths below — unlike
-- the reassignment case there is no legitimate reason to want this; the fix is to mint a fresh
-- link for that buyer, not to write into a dead one.
--
-- WHY THIS DOES NOT ALSO REQUIRE AN EXISTING GRANT/DELIVERY BEFORE ALLOWING THE ATTACH.
-- Attaching the vendor is how GC records WHO the deal closed with, which can happen before,
-- during, or after the delivery/grant paperwork lands — GC's own workflow, not this RPC's
-- business to sequence. The actual authorization gate belongs, and already lives, entirely at
-- read time in the master-download route (rule 11: "enforce at the point of action, never as a
-- sweep") — this RPC only ever writes a fact, never a permission. title_vendor_licensed (below)
-- exists only to decide when that fact-write deserves a confirmation, not to gate it outright.
--
-- DETACH (fix round 1, item 4). p_vendor_id accepted as an explicit NULL means "detach" — the
-- only way to undo a mis-attach without writing a false fact via a forced reassignment to some
-- other company. No force required: it is the safe direction, the mirror image of judgement
-- call 1. It changes nothing about any grant, delivery, or title — only which buyer link can
-- resolve the master on its next read (rule 11's own framing: gate future actions, never
-- retroactively destroy state; detaching is exactly "the next read stops qualifying," not a
-- takedown of anything that already happened).
--
-- AUDIT — REVISED (fix round 1, item 1: CRITICAL, see below). This migration originally attached
-- the generic public.tg_audit() trigger to the whole portal_links table. That was wrong for the
-- exact reason 20260726000800 already documented and fixed on portal_sessions: tg_audit writes
-- to_jsonb() of the WHOLE row, and portal_links rows carry share_token (the raw, un-hashed portal
-- URL a buyer holds) and token_hash. audit_log has UPDATE and DELETE revoked for every role, so
-- either would have been copied into an append-only table with no purge path, permanently — for
-- share_token specifically, that is not "a credential artifact with zero audit value" (the
-- reasoning 20260726000800 used to accept token_hash); it IS the live credential. Every
-- create_screener_link call (a revoke, then an insert) would have written two such rows forever.
-- portal_links also carries recipient_name, an external person's name, into the same org_id-null,
-- unreachable-by-purge bucket 20260726000800 flagged for portal_sessions' PII.
--
-- Fixed the same way 20260726000800 fixed it: audit the TRANSITION, not the row. No trigger at
-- all — this RPC inserts exactly ONE audit_log row per genuine change (skipped entirely for the
-- idempotent same-vendor no-op), carrying only `{"vendor_id": ...}` before/after. No share_token,
-- no token_hash, no recipient_name ever enters audit_log through this path, by construction —
-- the jsonb objects are hand-built, not to_jsonb(row). org_id is resolved via a one-hop lookup
-- from the link's own title_id — the first version of this migration claimed that was
-- unreachable because portal_links has no org_id column; a title always belongs to exactly one
-- org, so that claim was simply wrong, not a real constraint.
--
-- DESTRUCTIVE OPS (approved before apply): CREATE two new functions —
-- public.title_vendor_licensed(uuid, uuid) and public.attach_link_vendor(uuid, uuid, boolean) —
-- each with its own grant, no overloads. NO trigger of any kind is added to portal_links (the
-- fix-round-1 correction above). No table altered, no column added or dropped, no row deleted.
-- Forward-only. To roll back: drop both functions — no other object depends on either.
--
-- ============================================================================
-- 1. title_vendor_licensed — "would this (title, vendor) pair release the master right now."
--    Mirrors src/lib/master-licence.ts's isMasterLicensed exactly (same status allow-list,
--    same grant-expiry/window/territory logic) so the confirmation this gates matches what the
--    buyer-portal route actually enforces. This is a known, pre-existing duplication (Task 9's
--    own follow-up already named the right long-term fix — a shared
--    portal_resolve_buyer_master RPC both sides call — as future work, not this migration's
--    job); noted rather than silently repeated a third time without comment.
-- ============================================================================
create or replace function public.title_vendor_licensed(p_title_id uuid, p_vendor_id uuid)
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.deliveries d
      join public.rights_grants g on g.id = d.grant_id
     where d.title_id  = p_title_id
       and d.vendor_id = p_vendor_id
       and d.status in ('pending', 'delivered', 'live')
       and g.effective_to is null
       and (g.window_start is null or now() >= g.window_start)
       and (g.window_end   is null or now() <= g.window_end)
       and case g.territory_mode
             when 'world'   then true
             when 'include' then d.territory = any (g.territories)
             when 'exclude' then not (d.territory = any (g.territories))
             else false
           end
  );
$$;

revoke execute on function public.title_vendor_licensed(uuid, uuid) from public, anon;
grant  execute on function public.title_vendor_licensed(uuid, uuid) to authenticated;

-- ============================================================================
-- 2. attach_link_vendor — GC-operate only. See header for the judgement calls, detach, and audit.
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
  v_title_id       uuid;
  v_org_id         uuid;
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

  select purpose, revoked_at, expires_at, vendor_id, title_id
    into v_purpose, v_revoked_at, v_expires_at, v_current_vendor, v_title_id
    from public.portal_links where id = p_link_id;
  if not found then raise exception 'Link not found'; end if;

  -- master_download links get their vendor from the delivery they were minted against
  -- (deliveries.vendor_id) and were never given a share_token a buyer could hold onto; only a
  -- screener_view (buyer pitch) link is the thing this RPC exists to complete.
  if v_purpose <> 'screener_view' then
    raise exception 'Only a buyer screener link can carry a vendor';
  end if;

  -- Judgement call 2: a dead link can never be resolved again (portal_resolve_screener rejects
  -- both states), so writing into one — attach OR detach — would be invisible and pointless.
  -- No force override; applies before the attach/detach branch below, uniformly.
  if v_revoked_at is not null then
    raise exception 'Link has been revoked';
  end if;
  if v_expires_at <= now() then
    raise exception 'Link has expired';
  end if;

  -- org_id for the audit row below: a one-hop lookup from the link's own title. portal_links
  -- itself has no org_id column, but that is not the same claim as "unreachable" — a title
  -- always belongs to exactly one org.
  select org_id into v_org_id from public.titles where id = v_title_id;

  -- DETACH (see header). Safe direction, no force, no vendor validity to check.
  if p_vendor_id is null then
    if v_current_vendor is null then
      return; -- already detached — idempotent no-op, nothing changed, nothing to audit
    end if;
    insert into public.audit_log (org_id, entity, entity_id, action, actor, before, after)
    values (v_org_id, 'portal_links', p_link_id, 'detach_vendor', auth.uid(),
            jsonb_build_object('vendor_id', v_current_vendor), jsonb_build_object('vendor_id', null));
    update public.portal_links set vendor_id = null where id = p_link_id;
    return;
  end if;

  select active into v_vendor_active from public.vendors where id = p_vendor_id;
  if not found then raise exception 'Vendor not found'; end if;
  if not v_vendor_active then raise exception 'Vendor is not active'; end if;

  if v_current_vendor is null then
    -- FIRST ATTACH — the higher-consequence transition (see judgement call 1). Guarded exactly
    -- when this pair would immediately satisfy the master's own licence check.
    if not coalesce(p_force, false) and public.title_vendor_licensed(v_title_id, p_vendor_id) then
      raise exception
        'This vendor already has an active grant and delivery for this title — attaching releases the master immediately. Pass force to confirm.';
    end if;
  elsif v_current_vendor <> p_vendor_id then
    -- REASSIGNMENT to a different vendor. Blocked unless forced (see header).
    if not coalesce(p_force, false) then
      raise exception 'Link already has a different vendor attached — pass force to reassign';
    end if;
  else
    -- Re-attaching the SAME vendor: idempotent no-op. Nothing changed, nothing to audit.
    return;
  end if;

  -- Audit the transition, not the row (see header) — one hand-built row, vendor_id only.
  insert into public.audit_log (org_id, entity, entity_id, action, actor, before, after)
  values (v_org_id, 'portal_links', p_link_id, 'attach_vendor', auth.uid(),
          jsonb_build_object('vendor_id', v_current_vendor), jsonb_build_object('vendor_id', p_vendor_id));

  update public.portal_links set vendor_id = p_vendor_id where id = p_link_id;
end; $$;

revoke execute on function public.attach_link_vendor(uuid, uuid, boolean) from public, anon;
grant  execute on function public.attach_link_vendor(uuid, uuid, boolean) to authenticated;
