-- 20260806000200_client_screener_share_links.sql
--
-- INTENT: a rights holder must be able to send their own approved title's screener to a
-- prospective buyer. Until now create_screener_link was GC-only (gc_can(...,'operate')), so
-- the client had no way to mint one and the in-app player is no substitute — its signed URL
-- expires in 2 hours and carries no OTP gate.
--
-- AUTHORIZATION becomes member_can(auth.uid(), <title org>, 'operate'). That ONE predicate
-- covers both parties: since 20260727000100, member_can routes a gc_staff caller through
-- gc_can(p_uid, p_capability), so GC operate staff keep exactly the access they had and a GC
-- role without 'operate' still cannot mint. For a client it resolves to account_owner or
-- delivery_ops. Deliberately NOT 'view': sending a screener outside the company is an
-- outbound act, not catalog-read-only, so viewer/accountant/legal are excluded. They can
-- still WATCH in-app (that rule lives in lib/assets screenerKindFor). Founder decision,
-- 2026-08-06.
--
-- STATUS GATE applies to CLIENTS ONLY. GC keeps any-status access because screening is how
-- the chain-of-title review is performed, and reviewers work pre-approval by definition. A
-- client may share once GC has approved (in_delivery / live / takedown_requested) but NOT on
-- a taken_down title — shopping a withdrawn title to a new buyer is the one case worth
-- blocking outright. Pre-approval there is nothing to show.
--
-- THE BUG THIS ALSO FIXES. The single-active-link model revoked EVERY live screener_view
-- link for the title before minting. That was correct while GC was the only author. With two
-- parties minting, a client sharing with a buyer would silently kill the link GC had already
-- emailed a vendor, and vice versa — no error, the URL just stops resolving. The revoke is
-- now partitioned by author (is_gc_staff(created_by) = the caller's own side), so each side
-- keeps its own single reusable link and neither can revoke the other's. Cross-party revoke
-- remains possible only through revoke_portal_link, which is a deliberate act.
--
-- THE READ SIDE. portal_links_select is gc_can(...,'view') — GC-only — so a client could
-- mint a link and never see it again, defeating the whole "one reusable link you can
-- re-copy" model the share_token column exists for. The policy is widened, narrowly:
--   * screener_view rows ONLY. master_download stays GC-only; its token post-OTP yields the
--     master itself, which is the reason it was never given a stored share_token.
--   * rows NOT authored by GC. A client sees their own side's link, not GC's outbound
--     vendor activity — the same partition the revoke uses, for the same reason.
--   * 'operate' on the title's org, matching who may create one.
--
-- REVOKE, likewise. revoke_portal_link was gc_can(...,'operate'), so "stop sharing" would
-- have failed for the very client who just created the link. It takes only a link id, so the
-- client branch re-derives what that id IS before allowing it: screener_view purpose, not
-- GC-authored, and 'operate' on the owning title's org. A client cannot revoke a
-- master_download link or GC's screener link by guessing an id.
--
-- DESTRUCTIVE OPS (approved before apply): CREATE OR REPLACE of revoke_portal_link (same name
-- and argument list, so no overload and no grant change), DROP + CREATE of policy
-- portal_links_select, and DROP + CREATE OR REPLACE of create_screener_link — that one DOES
-- change argument list (4 args -> 5, adding p_recipient_name) and therefore its grants, covered
-- below. ALTER TABLE adds two nullable columns (vendor_id, recipient_name) plus an index — both
-- additive, no backfill, no row rewritten with a default. No row deleted. Forward-only. To roll
-- back the function/policy definitions, re-apply the three from 20260727000100_gc_role_separation.sql
-- (create_screener_link :372, revoke_portal_link :581, policy :199) — but drop the 5-arg
-- create_screener_link FIRST. Re-applying the 4-arg definition without dropping the 5-arg one
-- first creates a second overload rather than replacing it (the same hazard Step 4 below exists
-- to avoid going forward): PostgREST resolves an `rpc('create_screener_link', {...})` call by
-- matching named arguments, and a 4-arg/5-arg pair whose first four parameter names are
-- identical is exactly the ambiguous case it cannot always disambiguate. To roll back the
-- columns, drop portal_links_title_recipient_idx and the two columns.
--
-- portal_links_title_idx (title_id) — defined in 20260720000300 — is now a redundant left
-- prefix of portal_links_title_recipient_idx (title_id, lower(recipient_name)): any plan that
-- would use the single-column index can use the composite one instead. Left in place
-- deliberately rather than dropped here — removing an existing index is its own decision
-- (it could be relied on by a plan this migration's author hasn't traced), separate from this
-- migration's purpose of adding buyer scoping. Founder call if it's worth a follow-up migration.
--
-- ONE LINK PER BUYER, NOT PER TITLE. A title-scoped single-active-link model cannot safely be
-- extended to offer the master itself: the moment any buyer licenses the title, every other
-- prospect still holding a "share the master" link for that title would qualify too. Scoping
-- the link — and its revoke — to (title, recipient, side) means a client pitching five buyers
-- holds five independent links; replacing one buyer's link never touches another's. vendor_id
-- stays null until GC attaches the vendor at deal time (vendors are GC-only, so a client cannot
-- pick one from their side of this RPC).
--
-- CASE-INSENSITIVE MATCH, CASE-PRESERVING STORAGE. recipient_name is free text a GC or client
-- user types (Task 5 puts it behind a plain input), so 'Tubi' and 'tubi' are the same buyer to
-- a human retyping the name, not two. Matching exact-case would mean a client who re-types a
-- name with different casing gets a SECOND live link instead of resetting the first — the
-- already-emailed URL for the first stays resolvable indefinitely, which is precisely the
-- leak single-active exists to prevent. The column stores the name AS TYPED after trim
-- (`nullif(btrim(p_recipient_name), '')`). Lookup, revoke, uniqueness, and verification all
-- use one canonical key: `nullif(lower(btrim(recipient_name)), '')`. Blank and whitespace-only
-- values fold to NULL and share the unnamed key.
--
-- UNIQUENESS + TITLE LOCK (2026-08-14 repair, unapplied). Concurrent create_screener_link
-- calls can both pass the revoke-then-insert window. The title row is locked FOR UPDATE
-- before revoke/insert. A partial unique index on (title_id, canonical key) WHERE live
-- screener_view, NULLS NOT DISTINCT, is the security invariant. Unexpected unique_violation
-- is converted to a stable, non-disclosing P0001. Before the index is created, an
-- aggregate-only DO fails closed if any title already has multiple live screener_view rows
-- — no row is modified, revoked, or selected by identifier.
alter table public.portal_links
  add column if not exists vendor_id      uuid references public.vendors(id) on delete restrict,
  add column if not exists recipient_name text;

create index if not exists portal_links_title_recipient_idx
  on public.portal_links (title_id, (nullif(lower(btrim(recipient_name)), '')));

do $$
declare
  v_titles int;
begin
  select count(*) into v_titles from (
    select title_id
      from public.portal_links
     where purpose = 'screener_view'
       and revoked_at is null
     group by title_id
    having count(*) > 1
  ) s;
  if v_titles > 0 then
    raise exception
      'portal_links_active_screener_recipient_uidx: % titles have multiple live screener_view rows; founder remediation required; no rows changed',
      v_titles;
  end if;
end $$;

create unique index if not exists portal_links_active_screener_recipient_uidx
  on public.portal_links (title_id, (nullif(lower(btrim(recipient_name)), '')))
  nulls not distinct
  where purpose = 'screener_view' and revoked_at is null;

-- The 4-arg signature is being replaced by a 5-arg one (p_recipient_name added). A plain CREATE
-- OR REPLACE with a different argument list creates a SECOND overload instead of replacing the
-- first, leaving the old 4-arg function callable (and its grants intact) alongside the new one —
-- this mirrors the create_title pattern already used in this repo.
drop function if exists public.create_screener_link(uuid, text, timestamptz, text);

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
  v_recipient_key text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  -- org_id and status are needed for authorization, so read them with the source.
  -- FOR UPDATE serializes concurrent mints on this title (unique index is the invariant).
  select screener_source, status, org_id
    into v_source, v_status, v_org
    from public.titles where id = p_title_id
    for update;
  if not found then raise exception 'Title not found'; end if;

  if not public.member_can(auth.uid(), v_org, 'operate') then
    raise exception 'Not authorized';
  end if;

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

  -- Single active link per (title, recipient, side). Replacing Tubi's link must not touch
  -- Roku's, and neither may touch GC's outstanding vendor link. Canonical key
  -- `nullif(lower(btrim(recipient_name)), '')` is required for lookup, revoke, and the
  -- unique index: NULL and blank/whitespace share the unnamed key; 'Tubi'/'tubi'/' Tubi '
  -- are one buyer. `is not distinct from` is required so two unnamed keys match.
  -- Display storage stays `nullif(btrim(p_recipient_name), '')` (case-preserving).
  v_recipient_key := nullif(lower(btrim(p_recipient_name)), '');

  begin
    update public.portal_links
       set revoked_at = now()
     where title_id = p_title_id
       and purpose = 'screener_view'
       and revoked_at is null
       and public.is_gc_staff(created_by) = v_is_gc
       and nullif(lower(btrim(recipient_name)), '') is not distinct from v_recipient_key;

    insert into public.portal_links
      (purpose, title_id, token_hash, share_token, created_by, expires_at, recipient_name)
    values ('screener_view', p_title_id, btrim(p_token_hash), p_share_token, auth.uid(),
            coalesce(p_expires_at, now() + interval '14 days'), nullif(btrim(p_recipient_name), ''))
    returning id into v_id;
    return v_id;
  exception
    when unique_violation then
      raise exception 'Unable to create screener link';
  end;
end; $$;

revoke execute on function public.create_screener_link(uuid, text, timestamptz, text, text) from public, anon;
grant  execute on function public.create_screener_link(uuid, text, timestamptz, text, text) to authenticated;

-- ---- revoke: same widening, re-derived from the link id (see header) -------------------
create or replace function public.revoke_portal_link(p_link_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_purpose    public.portal_link_purpose;
  v_title_id   uuid;
  v_created_by uuid;
  v_org        uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select purpose, title_id, created_by
    into v_purpose, v_title_id, v_created_by
    from public.portal_links where id = p_link_id;
  if not found then raise exception 'Link not found'; end if;

  -- GC keeps blanket revoke (it is how an outstanding vendor link is withdrawn).
  if not public.gc_can(auth.uid(), 'operate') then
    if v_purpose <> 'screener_view' or public.is_gc_staff(v_created_by) then
      raise exception 'Not authorized';
    end if;
    select org_id into v_org from public.titles where id = v_title_id;
    if v_org is null or not public.member_can(auth.uid(), v_org, 'operate') then
      raise exception 'Not authorized';
    end if;
  end if;

  update public.portal_links set revoked_at = coalesce(revoked_at, now()) where id = p_link_id;
end; $$;

revoke execute on function public.revoke_portal_link(uuid) from public, anon;
grant  execute on function public.revoke_portal_link(uuid) to authenticated;

-- ---- read side: let an org re-copy its OWN screener link (see header) ------------------
drop policy if exists portal_links_select on public.portal_links;
create policy portal_links_select on public.portal_links for select to authenticated
  using (
    public.gc_can(auth.uid(), 'view')
    or (
      purpose = 'screener_view'
      and title_id is not null
      and not public.is_gc_staff(created_by)
      and exists (
        select 1 from public.titles t
        where t.id = portal_links.title_id
          and public.member_can(auth.uid(), t.org_id, 'operate')
      )
    )
  );
