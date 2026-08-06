-- 20260806000300_unify_screener_links.sql
--
-- SUPERSEDES the author partition introduced in 20260806000200_client_screener_share_links.sql.
-- That migration made create_screener_link, revoke_portal_link, and portal_links_select all
-- split screener_view links into two non-interacting sides — `is_gc_staff(created_by) = v_is_gc`
-- (or its read-side / revoke-side equivalent) — so a client's link and GC's link for the same
-- title could never collide, and a client could never see or revoke GC's outbound link. Founder
-- decision, 2026-08-06: remove that partition entirely. This migration does that and nothing
-- else — same two function signatures, same policy name, no schema change.
--
-- WHY THE PARTITION EXISTED AND WHY IT WAS WRONG. It was invented for a single-active-link-per-
-- TITLE model, where an unfiltered revoke meant a client sharing with anyone would kill the link
-- GC had already emailed to a vendor, and vice versa (20260806000200's header, "THE BUG THIS
-- ALSO FIXES"). But that same migration ALSO added recipient_name and made the model one-link-
-- per-(title, recipient) — and the recipient is what actually disambiguates Tubi's link from
-- Roku's. Once that landed, the author partition stopped doing anything a client couldn't
-- already get from naming their buyer correctly, and it started actively causing the exact
-- problem recipient-scoping was supposed to solve: if GC and the client both pitch Tubi, Tubi
-- now receives TWO different URLs for the same film, and its watch/engagement data — the whole
-- point of a named, trackable link — splits across two rows that never talk to each other.
-- Worse, the read-side partition hid GC's own outbound activity from the client whose title and
-- whose revenue it is. This project's rules make that transparency a brand requirement (CLAUDE.md
-- "Show the work"), not a UX nicety GC can withhold. Hiding it was never defensible; the
-- recipient key made it also unnecessary.
--
-- THE NEW RULE. One active screener_view link per (title, recipient). Whoever created it. GC and
-- a client sharing with the SAME buyer now collide on purpose — the second call revokes the
-- first, same as two client users (or two GC staff) naming the same buyer twice already did.
-- Different buyers still never collide; that part of 20260806000200 is untouched. The RPC's own
-- comment block below and in create_screener_link is the one and only place "the same buyer"
-- is defined; nothing here changes that definition, only who it applies across.
--
-- WHAT ACTUALLY CHANGES, function by function:
--
--   create_screener_link (5-arg signature UNCHANGED, so no drop/regrant — a plain CREATE OR
--   REPLACE keeps the existing grant to `authenticated`). The revoke's `and
--   public.is_gc_staff(created_by) = v_is_gc` conjunct is deleted outright, not adapted — with it
--   gone, the revoke matches purely on (title_id, purpose, lower(recipient_name)), which is the
--   whole point. v_is_gc is NOT removed: it still gates the pre-approval status check (clients
--   may only share once GC has approved; GC screens pre-approval by definition, since screening
--   IS how chain-of-title review happens). That is the only remaining use of v_is_gc, and it is a
--   real one — not dead code kept out of caution.
--
--   revoke_portal_link. The client branch's `or public.is_gc_staff(v_created_by)` refusal is
--   deleted, so the condition guarding a non-GC caller becomes just `v_purpose <> 'screener_view'`
--   — any org member with 'operate' on the owning title may now revoke ANY screener_view link on
--   that title, including one GC created. That follows directly from the new rule: if a client
--   can now cause GC's link to stop existing by re-sharing with the same buyer, forbidding them
--   from stopping it directly via "Stop sharing" would be an arbitrary, indefensible asymmetry.
--   master_download stays GC-only — that branch is untouched. Deleting the refusal also makes
--   v_created_by dead: it was selected only to feed that one comparison. Rather than leave an
--   unused local, this drops `created_by` from the SELECT and the `v_created_by` declaration
--   entirely, per the "don't leave dead code" instruction — a smaller function, not a stale one.
--
--   portal_links_select. The client branch's `and not public.is_gc_staff(created_by)` conjunct is
--   deleted, so a client with 'operate' on a title's org now sees every screener_view row for
--   that title — GC-authored included. The `purpose = 'screener_view'` conjunct is untouched and
--   still does the real gatekeeping: master_download rows remain visible only through the first
--   branch (`gc_can(auth.uid(), 'view')`), because that purpose was never given the widened
--   client branch to begin with. Removing the author conjunct doesn't touch that — the two
--   conjuncts were independent restrictions ANDed together, not one condition standing in for
--   both purposes.
--
-- WHAT DOES NOT CHANGE. The case-insensitive, trim-then-fold recipient match (`lower(...) is
-- not distinct from lower(nullif(btrim(...), ''))`) — untouched, still required for the same
-- reason 20260806000200 documented it (three-valued NULL comparison, and 'Tubi'/'tubi' being the
-- same human buyer). The 14-day default expiry, the screenable-asset guard, the token/expiry
-- validation, the pre-approval status gate, and master_download's GC-only revoke and read path —
-- none of that is this migration's concern and none of it moves.
--
-- DESTRUCTIVE OPS (approved before apply): CREATE OR REPLACE of create_screener_link (same name,
-- same 5-arg list — no overload, no grant change, no revoke/grant statements needed). CREATE OR
-- REPLACE of revoke_portal_link (same 1-arg signature — same reasoning). DROP + CREATE of policy
-- portal_links_select (policies have no independent grant to preserve; DROP + CREATE is how this
-- repo replaces one, same as 20260806000200 and 20260727000100 before it). No table altered, no
-- column added or dropped, no row deleted, no row touched by this migration at all — it is pure
-- function/policy redefinition. Forward-only. To roll back, re-apply the three definitions from
-- 20260806000200_client_screener_share_links.sql (create_screener_link :98, revoke_portal_link
-- :175, policy :208) — no DROP FUNCTION needed first in either direction since neither signature
-- changes.

create or replace function public.create_screener_link(
  p_title_id       uuid,
  p_token_hash     text,
  p_expires_at     timestamptz default null,
  p_share_token    text default null,
  p_recipient_name text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_source public.screener_source;
  v_status public.title_status;
  v_org    uuid;
  v_is_gc  boolean;
  v_id     uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  -- org_id and status are needed for authorization, so read them with the source.
  select screener_source, status, org_id
    into v_source, v_status, v_org
    from public.titles where id = p_title_id;
  if not found then raise exception 'Title not found'; end if;

  if not public.member_can(auth.uid(), v_org, 'operate') then
    raise exception 'Not authorized';
  end if;

  -- Still needed: gates the pre-approval status check just below. It no longer touches the
  -- revoke predicate — that partition is gone (see migration header).
  v_is_gc := public.is_gc_staff(auth.uid());

  if not v_is_gc and v_status not in ('in_delivery', 'live', 'takedown_requested') then
    raise exception 'A screener can be shared once GC has approved the title';
  end if;

  -- Unchanged: the link must have something to serve.
  if v_source = 'dedicated' then
    if not exists (select 1 from public.assets where title_id = p_title_id and kind = 'screener') then
      raise exception 'Screener source is set to dedicated but no screener has been uploaded';
    end if;
  else
    if not exists (select 1 from public.assets where title_id = p_title_id and kind = 'master') then
      raise exception 'No master asset to screen';
    end if;
  end if;

  if coalesce(btrim(p_token_hash), '') = '' then raise exception 'token_hash required'; end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expires_at must be in the future';
  end if;

  -- Single active link per (title, recipient) — full stop. No author partition: whoever shares
  -- with a given buyer next revokes whoever shared with that buyer last, GC included. `is not
  -- distinct from` is required, not cosmetic: in SQL's three-valued logic `null = null` evaluates
  -- to null (not true), so a plain `=` would never match two unnamed links to each other and they
  -- would accumulate forever instead of single-active resetting. `lower(...)` on both sides makes
  -- the match case-insensitive — 'Tubi' and 'tubi' are the same buyer to whoever retyped the
  -- name, and matching exact-case would leave the first casing's link live and resolvable forever
  -- instead of resetting it. The stored column itself keeps the case as typed; only the
  -- comparison folds it.
  update public.portal_links
     set revoked_at = now()
   where title_id = p_title_id
     and purpose = 'screener_view'
     and revoked_at is null
     and lower(recipient_name) is not distinct from lower(nullif(btrim(p_recipient_name), ''));

  insert into public.portal_links
    (purpose, title_id, token_hash, share_token, created_by, expires_at, recipient_name)
  values ('screener_view', p_title_id, btrim(p_token_hash), p_share_token, auth.uid(),
          coalesce(p_expires_at, now() + interval '14 days'), nullif(btrim(p_recipient_name), ''))
  returning id into v_id;
  return v_id;
end; $$;

-- Signature unchanged from 20260806000200 (5 args) — no revoke/grant statements needed; CREATE OR
-- REPLACE preserves the existing grant to `authenticated`.

-- ---- revoke: same unification, re-derived from the link id ----------------------------
create or replace function public.revoke_portal_link(p_link_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_purpose  public.portal_link_purpose;
  v_title_id uuid;
  v_org      uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select purpose, title_id
    into v_purpose, v_title_id
    from public.portal_links where id = p_link_id;
  if not found then raise exception 'Link not found'; end if;

  -- GC keeps blanket revoke (it is how an outstanding vendor link is withdrawn).
  -- A non-GC caller may revoke ANY screener_view link on a title they operate — GC-authored
  -- included. No author refusal here anymore: if a client's own re-share can already cause GC's
  -- link to stop existing (the revoke inside create_screener_link, above), refusing them the
  -- direct "Stop sharing" action on that same row would be an arbitrary asymmetry, not a
  -- protection. master_download is untouched — still GC-only via `v_purpose <> 'screener_view'`.
  if not public.gc_can(auth.uid(), 'operate') then
    if v_purpose <> 'screener_view' then
      raise exception 'Not authorized';
    end if;
    select org_id into v_org from public.titles where id = v_title_id;
    if v_org is null or not public.member_can(auth.uid(), v_org, 'operate') then
      raise exception 'Not authorized';
    end if;
  end if;

  update public.portal_links set revoked_at = coalesce(revoked_at, now()) where id = p_link_id;
end; $$;

-- Signature unchanged from 20260727000100 (1 arg) — no revoke/grant statements needed.

-- ---- read side: an org sees every screener link on its own title, GC's included -------
drop policy if exists portal_links_select on public.portal_links;
create policy portal_links_select on public.portal_links for select to authenticated
  using (
    public.gc_can(auth.uid(), 'view')
    or (
      purpose = 'screener_view'
      and title_id is not null
      and exists (
        select 1 from public.titles t
        where t.id = portal_links.title_id
          and public.member_can(auth.uid(), t.org_id, 'operate')
      )
    )
  );
