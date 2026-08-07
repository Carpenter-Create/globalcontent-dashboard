-- 20260807000200_attach_link_vendor_default_null.sql
--
-- INTENT: `attach_link_vendor` (20260806000400) declared `p_vendor_id uuid` with no SQL
-- DEFAULT, then the TS side hand-edited database.types.ts to `p_vendor_id: string | null`
-- so the detach call site (passing an explicit null) would compile. That hand-edit is not
-- something `supabase gen types` produces — the documented gotcha in this repo's CLAUDE.md is
-- that the generator marks every arg WITHOUT a DEFAULT as required and non-null, full stop; a
-- nullable-but-required argument is not an expressible TS shape. Regenerating types against the
-- live schema silently reverts the hand-edit back to `p_vendor_id: string`, and the resulting
-- build failure points at the detach call site in actions.ts, not at this function's signature —
-- a trap for whoever next runs the generator per this repo's own conventions.
--
-- FIX: add `default null` to p_vendor_id. This is a genuine CREATE OR REPLACE, not a new
-- overload and not a breaking change to anything already granted:
--
--   - Postgres identifies a function by (schema, name, ARGUMENT TYPES) — pg_proc.proargtypes.
--     Parameter NAMES, DEFAULTS, volatility, language, and body are not part of that identity.
--     `attach_link_vendor(uuid, uuid, boolean)` before and after this migration is the exact
--     same type signature: (uuid, uuid, boolean). Adding a default value only writes to
--     pg_proc.proargdefaults; it does not touch proargtypes. So this CREATE OR REPLACE updates
--     the existing function in place (same oid) rather than creating a second, overloaded
--     `attach_link_vendor` — Postgres would only treat it as a distinct function if the argument
--     TYPES or COUNT-without-defaults changed, neither of which is happening here.
--   - Because it is the same oid, not a drop-and-recreate, CREATE OR REPLACE FUNCTION preserves
--     the function's existing ownership and ACL (grants) exactly as PostgreSQL's own docs say:
--     replacing a function's definition does not reset its permissions. The
--     `revoke ... from public, anon; grant execute ... to authenticated;` pair already applied
--     by 20260806000400 remains in force. No grant statements are repeated here — doing so would
--     imply they were ever at risk, and they are not.
--
-- CALL-SITE CONSEQUENCE: with the default in place, `supabase gen types` will emit
-- `p_vendor_id?: string` (optional, non-null) instead of the hand-edited `string | null`.
-- Detach must now be invoked by OMITTING the argument (passing `undefined` through
-- `.rpc(...)`), not by passing an explicit `null` — PostgREST omits an absent key entirely,
-- and the SQL default supplies NULL server-side, so the existing
-- `if p_vendor_id is null then ... -- DETACH` branch below runs completely unchanged. This
-- migration changes no application logic, only how "no vendor" is spelled at the call boundary.
--
-- The function body below is copied verbatim from 20260806000400_attach_link_vendor.sql. The
-- ONLY change is the added `default null` on the p_vendor_id parameter line. Diffed against the
-- original before committing; nothing else moved.
--
-- DESTRUCTIVE OPS (approved before apply): none. This is a CREATE OR REPLACE of an existing
-- function with an identical signature and body, adding one parameter default. No table
-- altered, no column added or dropped, no row deleted, no grant changed. Forward-only. To roll
-- back: CREATE OR REPLACE the function again without the default (i.e. re-run
-- 20260806000400's function body).

create or replace function public.attach_link_vendor(
  p_link_id   uuid,
  p_vendor_id uuid default null,
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

-- No grant statements here — see header. The oid is unchanged, so the grants
-- 20260806000400 already applied (revoke from public/anon, grant execute to authenticated)
-- still hold.
