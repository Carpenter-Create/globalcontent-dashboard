-- 20260806000500_require_buyer_name.sql
--
-- INTENT: close the last known hole in the buyer-screener gate. 5892805 taught
-- portal_resolve_screener / the /api/portal/screener route to refuse a NAMED buyer link on a
-- 'master'-source title, because on that default the screener IS the master byte-for-byte
-- (screenerKindFor's comment, lib/assets.ts) — a <video> stream and a one-click download differ
-- only in how many clicks it takes to walk off with an unwatermarked deliverable. That gate's
-- discriminator (src/app/api/portal/screener/route.ts, "Buyer-link gate") is entirely
-- `recipient_name`: non-null means a client-minted buyer pitch, null means GC's own operational
-- link, which is deliberately exempt (that risk predates the gate and is GC's own workflow to
-- carry). Everything downstream of that discriminator assumes recipient_name faithfully records
-- WHO a link is for.
--
-- THE HOLE. create_screener_link (20260806000300) declares `p_recipient_name text default
-- null` and imposes no non-null requirement on the client branch. It is granted to
-- `authenticated`, and this repo ships a browser Supabase client (CLAUDE.md: "Anything a user
-- could cheat by editing client code lives in an edge function"). The ONLY thing currently
-- requiring a name is a guard in the server action (src/app/(app)/titles/[id]/actions.ts,
-- createBuyerScreenerLink: `if (!recipient) return { error: "Enter the buyer's name." }`) — app
-- code, trivially skipped by calling supabase.rpc('create_screener_link', ...) directly from the
-- browser console with p_recipient_name omitted. A seated client account_owner or delivery_ops
-- doing that mints a link the gate then classifies as GC-operational and exempts, streaming the
-- master to themselves under the buyer-portal flow instead of the (also gateable, separately
-- authorized) direct owner-download path. Not a cross-tenant leak — the actor is the title's own
-- rights holder and the bytes are their own master — but a guardrail sitting in the wrong layer:
-- CLAUDE.md rule 1 makes RLS/the DB the authorization layer, rule 10 puts anything client-code-
-- cheatable behind a DB boundary. An app-layer check was doing a database's job.
--
-- THE FIX. One guard added to create_screener_link's existing client-only branch (the same
-- `not v_is_gc` branch that already gates the pre-approval status check): a non-GC caller must
-- supply a non-blank p_recipient_name, or the call raises before touching the revoke/insert.
-- `coalesce(btrim(p_recipient_name), '') = ''` mirrors the exact "blank" definition the rest of
-- the function already uses for storage (`nullif(btrim(p_recipient_name), '')`) and for the
-- revoke-match (`lower(nullif(btrim(p_recipient_name), ''))`) — so "whitespace-only" is refused
-- here for the identical reason it would otherwise have been silently folded to null further
-- down and misclassified as a GC-style unnamed link. GC's own branch is untouched: GC must still
-- be able to omit the name entirely (gc/review/actions.ts's createScreenerLink calls the RPC
-- with p_recipient_name never even passed) — that is the behavior the exemption in the buyer-
-- link gate depends on, and this migration does not touch it.
--
-- WHY NOT IN THE APP LAYER ONLY. Already tried — that's the hole. The server action's own guard
-- is kept (fail fast with a friendly message beats a raw Postgres exception surfaced to a form),
-- but its comment now says what it actually is: a UX nicety duplicating a rule the database
-- enforces regardless, not the rule itself.
--
-- EVERYTHING ELSE IS BYTE-IDENTICAL to 20260806000300's create_screener_link body — this
-- migration's diff against that one is exactly the six new lines below (a blank comment line,
-- a two-line comment, and the three-line `if` block) and nothing else. No other function in
-- 20260806000300 (revoke_portal_link, the portal_links_select policy) or in 20260806000400
-- (title_vendor_licensed, attach_link_vendor) is touched.
--
-- DESTRUCTIVE OPS (approved before apply): CREATE OR REPLACE of public.create_screener_link,
-- IDENTICAL 5-argument signature to 20260806000300/20260806000200 — no drop, no overload, no
-- grant/revoke statement needed or included; CREATE OR REPLACE preserves the existing grant to
-- `authenticated`. No table altered, no column added or dropped, no row deleted, no row touched
-- by this migration at all — pure function redefinition. Forward-only. To roll back: re-apply
-- the function body from 20260806000300_unify_screener_links.sql verbatim (lines 82-154 there).
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

  -- 20260806000500: a client-branch link MUST name a buyer. The buyer-link gate
  -- (src/app/api/portal/screener/route.ts) treats a null recipient_name as GC's own
  -- operational link and exempts it from the master-source stream refusal — so a client
  -- minting an unnamed link would be misclassified as GC-operational and stream the master
  -- byte-for-byte. GC's own branch is untouched: GC must still be able to omit the name
  -- entirely (gc/review/actions.ts never passes p_recipient_name at all), which is the
  -- behavior that exemption depends on. `coalesce(btrim(...), '') = ''` refuses both a missing
  -- name and a whitespace-only one, matching the exact "blank" definition already used below
  -- for storage and for the revoke-match — a whitespace name would otherwise fold to null and
  -- be misclassified the same way an omitted one would.
  if not v_is_gc and coalesce(btrim(p_recipient_name), '') = '' then
    raise exception 'A buyer name is required';
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

-- Signature unchanged from 20260806000300/200 (5 args) — no revoke/grant statements needed;
-- CREATE OR REPLACE preserves the existing grant to `authenticated`.
