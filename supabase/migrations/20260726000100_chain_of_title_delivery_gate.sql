-- ============================================================================
-- 20260726000100_chain_of_title_delivery_gate.sql
--
-- INTENT: close L7. Status transitions are already locked — only submit_title and
-- review_title write titles.status, no trigger does, and PostgREST UPDATE is denied
-- to client roles AND to gc_staff. But nothing on the DELIVERY side ever read
-- titles.status, so a title that was never submitted and never reviewed could be
-- given a delivery record, marked live, have a master-download link minted, and be
-- written into an export. Proven live: scripts/security/l7-chain-of-title-gate.mjs.
--
-- The only thing enforcing "reviewed before delivered" was a dropdown filter at
-- src/app/(app)/(operator)/gc/deliveries/page.tsx:29-31. A UI-only rule is not a rule.
--
-- SHAPE: mirrors create_delivery's existing rights-grant validation — a targeted
-- lookup, then `if not found / if <> ... then raise exception`, commented with the
-- rule it enforces. No new tables, no policy changes, no data changes.
--
-- D4 DECISION BAKED IN HERE: **hard block**, per security-remediation-plan.md §3.4
-- and out-of-repo-checklist.md D4 ("Hard block is correct by default"). If a
-- legitimate rush path exists, revert this single migration and it will be rewritten
-- as an explicit override that writes to audit_log.
--
-- FOUR of the five RPCs are gated. create_screener_link is deliberately NOT — see
-- the note at the bottom of this file.
--
-- TWO DIFFERENT PREDICATES, deliberately:
--   * "is currently deliverable"  -> titles.status = 'in_delivery'
--     Used where a NEW delivery artifact is being created. Correct because it also
--     stops re-delivering a title that has since been pulled.
--   * "has ever passed review"    -> exists(title_reviews where decision='approve')
--     Used for set_delivery_status, because titles.status will eventually move to
--     takedown_requested/taken_down and gating that path on 'in_delivery' would make
--     it impossible to record the takedown — the status write would deadlock against
--     its own precondition. title_reviews is append-only, so this predicate is
--     durable across later status changes.
--
-- DESTRUCTIVE OPS: none. CREATE OR REPLACE on four existing functions; signatures
-- unchanged, so no TS type regeneration is needed. Forward-only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. create_delivery — a delivery may only be created for an approved title.
-- ----------------------------------------------------------------------------
create or replace function public.create_delivery(
  p_title_id uuid, p_vendor_id uuid, p_grant_id uuid, p_territory text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid;
  v_rt     public.rights_type;
  v_excl   boolean;
  v_terr   text := upper(btrim(p_territory));
  v_work   uuid;
  v_status public.title_status;
  v_id     uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;
  if v_terr !~ '^[A-Z]{2}$' then raise exception 'Territory must be an ISO 3166-1 alpha-2 code'; end if;

  select org_id, work_id, status into v_org, v_work, v_status
  from public.titles where id = p_title_id;
  if not found then raise exception 'Title not found'; end if;

  -- L7 / chain of title: review_title is the sole writer of 'in_delivery' and it only
  -- accepts a title already 'in_review', so this one predicate IS the gate.
  if v_status <> 'in_delivery' then
    raise exception 'Chain of title: "%" has not been approved for delivery (status: %)',
      p_title_id, v_status;
  end if;

  if not exists (select 1 from public.vendors where id = p_vendor_id and active) then
    raise exception 'Vendor not found or inactive';
  end if;

  -- Rule 12: the SPECIFIC grant must belong to this title, be active, and cover the
  -- rights/territory/window at now(). Captures its rights_type + exclusivity.
  select rights_type, exclusive into v_rt, v_excl
  from public.rights_grants
  where id = p_grant_id and title_id = p_title_id and effective_to is null
    and (window_start is null or now() >= window_start)
    and (window_end   is null or now() <= window_end)
    and case territory_mode
          when 'world'   then true
          when 'include' then v_terr = any (territories)
          when 'exclude' then not (v_terr = any (territories))
        end;
  if not found then
    raise exception 'No active grant on this title covers % (%s)', v_terr, p_grant_id;
  end if;

  -- Hard cross-client conflict block: same work, another org, same rights_type,
  -- overlapping territory, an exclusive claim involved. Runs as owner (sees all orgs).
  if v_work is not null and exists (
    select 1
    from public.titles t2
    join public.rights_grants g2 on g2.title_id = t2.id and g2.effective_to is null
      and g2.rights_type = v_rt
      and public.territories_overlap('include', array[v_terr], g2.territory_mode, g2.territories)
      and (v_excl or g2.exclusive)
    where t2.work_id = v_work and t2.org_id <> v_org
  ) then
    raise exception 'Blocked: another client holds a conflicting exclusive claim on this work for % in %', v_rt, v_terr;
  end if;

  insert into public.deliveries (org_id, title_id, vendor_id, grant_id, territory, created_by)
  values (v_org, p_title_id, p_vendor_id, p_grant_id, v_terr, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. set_delivery_status — the delivery's title must have passed review at least once.
--    Durable predicate (see header): a takedown must remain recordable after
--    titles.status leaves 'in_delivery'.
-- ----------------------------------------------------------------------------
create or replace function public.set_delivery_status(
  p_delivery_id uuid, p_status public.delivery_status, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_title uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;

  select title_id into v_title from public.deliveries where id = p_delivery_id;
  if not found then raise exception 'Delivery not found'; end if;

  -- L7 / chain of title. Transitively guaranteed once create_delivery is gated, but
  -- stated here too: this is the RPC that puts a title 'live' on a platform, and it
  -- should not depend on another function's check for that.
  if not exists (
    select 1 from public.title_reviews
    where title_id = v_title and decision = 'approve'
  ) then
    raise exception 'Chain of title: delivery % is for a title that has never been approved', p_delivery_id;
  end if;

  update public.deliveries
    set status = p_status, status_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = p_delivery_id;
  if not found then raise exception 'Delivery not found'; end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. create_portal_link — minting a master-download link is the moment the vendor
--    gets the actual master. Gate on the delivery's title being currently deliverable.
-- ----------------------------------------------------------------------------
create or replace function public.create_portal_link(
  p_delivery_id uuid, p_asset_id uuid, p_token_hash text, p_expires_at timestamptz default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_title uuid; v_status public.title_status; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;

  select d.title_id, t.status into v_title, v_status
  from public.deliveries d join public.titles t on t.id = d.title_id
  where d.id = p_delivery_id;
  if not found then raise exception 'Delivery not found'; end if;

  -- L7 / chain of title: never hand a master to a vendor for an unapproved title.
  if v_status <> 'in_delivery' then
    raise exception 'Chain of title: cannot mint a master-download link for a title with status %', v_status;
  end if;

  if not exists (
    select 1 from public.assets
    where id = p_asset_id and title_id = v_title and kind = 'master'
  ) then raise exception 'Asset must be a master asset on the delivery''s title'; end if;
  if coalesce(btrim(p_token_hash), '') = '' then raise exception 'token_hash required'; end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expires_at must be in the future';
  end if;

  insert into public.portal_links (delivery_id, asset_id, token_hash, created_by, expires_at)
  values (p_delivery_id, p_asset_id, btrim(p_token_hash), auth.uid(),
          coalesce(p_expires_at, now() + interval '14 days'))
  returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. record_export — every title in the batch must be currently deliverable.
--    Reports the offending ids rather than failing opaquely on a 50-title export.
-- ----------------------------------------------------------------------------
create or replace function public.record_export(
  p_vendor_id uuid, p_title_ids uuid[], p_payload jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_bad uuid[];
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;

  -- L7 / chain of title: an export is what GC represents to a distribution endpoint.
  -- Any id that is not an approved, currently-deliverable title fails the whole batch.
  -- (A nonexistent id lands here too; 20260726000200 adds the explicit integrity error.)
  select array_agg(x) into v_bad
  from unnest(p_title_ids) x
  where not exists (
    select 1 from public.titles t where t.id = x and t.status = 'in_delivery'
  );
  if v_bad is not null and array_length(v_bad, 1) > 0 then
    raise exception 'Chain of title: % of % title(s) in this export are not approved for delivery: %',
      array_length(v_bad, 1), coalesce(array_length(p_title_ids, 1), 0), v_bad;
  end if;

  insert into public.export_records (vendor_id, title_ids, payload, exported_by)
  values (p_vendor_id, p_title_ids, p_payload, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. create_screener_link — DELIBERATELY NOT GATED. Flagged, not fixed.
--
-- The screener is the instrument GC uses to PERFORM the chain-of-title review. The
-- operator opens an in_review title at /gc/titles/[id] and ScreenerPanel renders
-- right there (page.tsx:202, outside the `inReview` conditional; /queue lists
-- in_review alongside in_delivery). Gating create_screener_link on 'in_delivery'
-- would make it impossible to screen the title you are being asked to approve —
-- the gate would break the very review it exists to protect.
--
-- Left ungated on purpose. If you want a floor that still permits review, the
-- narrow version is "the client has turned it in", i.e.:
--
--     if v_status not in ('in_review','in_delivery') then
--       raise exception 'Screener links are available once a title is submitted (status: %)', v_status;
--     end if;
--
-- That blocks the L7 finding for drafts while leaving review intact. Not applied
-- here because it is a workflow decision, not a security one, and the instruction
-- was to flag rather than gate.
-- ----------------------------------------------------------------------------

-- Grants unchanged for all four (signatures identical); restated so the file is
-- self-contained if replayed. Note `from public, anon` — revoking from anon alone
-- leaves PostgreSQL's default PUBLIC grant in place (see 20260726000400).
revoke execute on function public.create_delivery(uuid, uuid, uuid, text) from public, anon;
grant  execute on function public.create_delivery(uuid, uuid, uuid, text) to authenticated;
revoke execute on function public.set_delivery_status(uuid, public.delivery_status, text) from public, anon;
grant  execute on function public.set_delivery_status(uuid, public.delivery_status, text) to authenticated;
revoke execute on function public.create_portal_link(uuid, uuid, text, timestamptz) from public, anon;
grant  execute on function public.create_portal_link(uuid, uuid, text, timestamptz) to authenticated;
revoke execute on function public.record_export(uuid, uuid[], jsonb) from public, anon;
grant  execute on function public.record_export(uuid, uuid[], jsonb) to authenticated;
