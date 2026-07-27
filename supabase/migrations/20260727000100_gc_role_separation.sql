-- ============================================================================
-- 20260727000100_gc_role_separation.sql
--
-- INTENT: make `gc_role` mean something. It currently means nothing.
--
-- THE DEFECT: `is_gc_staff(uid)` is `exists (select 1 from gc_staff where user_id = uid)`
-- — a membership test that never consults the row's `role`. Every one of the five GC roles
-- therefore has identical power. Measured, not assumed: 16 policies call `is_gc_staff`
-- directly, 15 functions call it as their sole authorization gate, and `member_can`
-- short-circuits on it for ALL 22 of its policies:
--
--     when public.is_gc_staff(p_uid) then true            -- <- the entire defect
--
-- So today a `gc_viewer` can create a delivery, approve a title for delivery (the
-- chain-of-title gate), mint a master-download URL, and revoke a portal session. CLAUDE.md
-- says GC roles "mirror these but scope inverts". The inversion shipped; the mirror did not.
--
-- THE SHAPE: one new function, one line changed in `member_can`, 15 policies and 15
-- functions repointed. `gc_can` speaks the SAME capability vocabulary as `member_can`
-- ('view' / 'view_financial' / 'operate' / 'manage_*'), so this adds no new concept — the
-- GC side simply starts answering the question the client side has always asked.
--
-- WHY member_can's SHORT-CIRCUIT IS THE HIGH-LEVERAGE LINE: 22 of 35 policies route through
-- it. Changing `then true` to `then gc_can(p_uid, p_capability)` gives every one of them GC
-- role separation without touching the policy itself, and it does so in the same code path
-- that already tells a client `delivery_ops` no. A `gc_delivery_ops` asking for
-- `view_financial` now gets refused by the same logic, for the same reason.
--
-- `is_gc_staff` IS DELIBERATELY UNCHANGED. It stays a pure membership predicate with no
-- capability logic and no session state. `gc_staff_select` keeps using it, so a staff member
-- can always read their own row — `(app)/(operator)/layout.tsx:15-22` queries that table to
-- decide whether to render the operator shell and REDIRECTS TO '/' when the read is empty.
-- Gate the identity read on a capability and a legitimately-scoped staff member is bounced
-- to the client dashboard with no explanation.
--
-- gc_viewer: BLOCKED, NOT DROPPED. Postgres has no `alter type ... drop value`; removing one
-- means a new type, a USING cast on the column, a drop and a rename, dragging the column
-- default and dependent signatures along. That is real risk for zero functional gain. A CHECK
-- constraint makes assignment fail loudly and is one line to reverse if a GC read-only seat
-- is ever wanted. Owner's decision, 2026-07-27: GC consists of owners, staff (delivery_ops),
-- legal and accountants. No viewer.
--
-- BLAST RADIUS ON DAY ONE: none. Production holds exactly one `gc_staff` row and its role is
-- `gc_account_owner`, for which `gc_can` returns true for every capability. Behaviour is
-- byte-identical until a second staff member exists — which is precisely why this is the
-- cheapest it will ever be.
--
-- CLIENT SIDE: unchanged. Verified before writing this — there is NO non-SELECT policy
-- reachable by `member_can(...,'view')`, so a client `viewer` cannot write any table.
--
-- ONE APPARENT EXCEPTION, examined and deliberately left alone. `mark_notifications_read` is
-- SECURITY DEFINER and gated 'view', so a `viewer` can cause a row to be written — which
-- looks like a view-only role taking an action, and a policy-level audit cannot see it at all
-- because the function is not a policy.
--
-- It writes `notification_reads (notification_id, user_id, read_at)`, keyed per user and
-- inserting `auth.uid()`. It marks THEIR OWN copy read. No other user's inbox changes, no org
-- state changes, nothing derived depends on it. Owner's call, 2026-07-27: that is a private
-- UI preference, not an action, and 'view' is the correct capability for it.
--
-- Recorded because the reasoning matters more than the outcome — "can this role write a row"
-- is the wrong question; "can this role affect anything anyone else can see" is the right one.
-- The two answers differ here, and only the second one is about authorization.
--
-- DESTRUCTIVE OPS: replaces two functions, replaces 15 policies, replaces 15 functions, and
-- adds one CHECK constraint. No table is dropped, no column altered, no row deleted or
-- modified. Forward-only. Requires no TS type regeneration — no signature changes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. gc_can — the GC mirror of member_can, minus the org scope (GC spans all orgs).
--
--    Capability names are IDENTICAL to member_can's on purpose. Two vocabularies for one
--    idea is how the two halves of an authorization model drift apart.
-- ----------------------------------------------------------------------------
create or replace function public.gc_can(p_uid uuid, p_capability text)
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select case
    when p_uid is null then false
    else exists (
      select 1 from public.gc_staff s
      where s.user_id = p_uid
        and case p_capability
          -- Reads. All four roles see operational data across every org.
          when 'view'               then s.role in ('gc_account_owner','gc_accountant','gc_legal','gc_delivery_ops')
          -- MONEY. Mirrors D1 exactly: delivery_ops is excluded ("no finance, no tax").
          when 'view_financial'     then s.role in ('gc_account_owner','gc_accountant','gc_legal')
          -- Operational writes: delivery, review, exports, portal links, vendors.
          -- `gc_legal` is absent by design — "read all, write nothing".
          when 'operate'            then s.role in ('gc_account_owner','gc_delivery_ops')
          when 'manage_tax_banking' then s.role in ('gc_account_owner','gc_accountant')
          when 'manage_billing'     then s.role =  'gc_account_owner'
          when 'manage_team'        then s.role =  'gc_account_owner'
          when 'manage_settings'    then s.role =  'gc_account_owner'
          else false                                   -- unknown capability fails CLOSED
        end
    )
  end;
$$;

revoke execute on function public.gc_can(uuid, text) from public;
grant  execute on function public.gc_can(uuid, text) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. THE ONE LINE. member_can's short-circuit stops being unconditional.
--    Every other branch is byte-identical to 20260726000900.
-- ----------------------------------------------------------------------------
create or replace function public.member_can(p_uid uuid, p_org uuid, p_capability text)
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select case
    when p_uid is null then false
    -- WAS: `then true`. GC scope still inverts (all orgs) — but the ROLE now decides which
    -- capability that scope carries. This single line applies role separation to all 22
    -- policies that route through member_can.
    when public.is_gc_staff(p_uid) then public.gc_can(p_uid, p_capability)
    else exists (
      select 1 from public.memberships m
      where m.user_id = p_uid
        and m.org_id  = p_org
        and m.status  = 'active'
        and case p_capability
          when 'view'               then m.role in ('account_owner','accountant','legal','delivery_ops','viewer')
          when 'view_financial'     then m.role in ('account_owner','accountant','legal')
          when 'operate'            then m.role in ('account_owner','delivery_ops')
          when 'manage_tax_banking' then m.role in ('account_owner','accountant')
          when 'manage_billing'     then m.role =  'account_owner'
          when 'manage_team'        then m.role =  'account_owner'
          when 'manage_settings'    then m.role =  'account_owner'
          else false
        end
    )
  end;
$$;

-- ----------------------------------------------------------------------------
-- 3. gc_viewer is not assignable. See the header for why this is a CHECK and not a
--    type change. Drop this constraint if a GC read-only seat is ever wanted.
-- ----------------------------------------------------------------------------
alter table public.gc_staff
  add constraint gc_staff_role_no_viewer check (role <> 'gc_viewer');

-- ----------------------------------------------------------------------------
-- 4. Policies. 15 repointed; `gc_staff_select` deliberately left on `is_gc_staff`.
-- ----------------------------------------------------------------------------

-- audit_log keeps its by-entity split and now applies it to GC too: a gc_delivery_ops
-- reading audit history does not get the financial rows, exactly as a client delivery_ops
-- does not. Note org_id IS NULL rows (portal_sessions audit) remain GC-only by construction.
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (
    case
      when public.is_gc_staff(auth.uid()) then
        case
          when entity in ('contract_terms','subscriptions','organizations','organization_payout_details')
            then public.gc_can(auth.uid(), 'view_financial')
          else public.gc_can(auth.uid(), 'view')
        end
      else (
        org_id is not null
        and case
          when entity in ('contract_terms','subscriptions','organizations','organization_payout_details')
            then public.member_can(auth.uid(), org_id, 'view_financial')
          else public.member_can(auth.uid(), org_id, 'view')
        end
      )
    end
  );

drop policy if exists deliveries_select on public.deliveries;
create policy deliveries_select on public.deliveries for select to authenticated
  using (public.gc_can(auth.uid(), 'view') or public.member_can(auth.uid(), org_id, 'view'));

drop policy if exists findings_select on public.findings;
create policy findings_select on public.findings for select to authenticated
  using (public.gc_can(auth.uid(), 'view') or public.member_can(auth.uid(), org_id, 'view'));

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (public.gc_can(auth.uid(), 'view') or public.member_can(auth.uid(), org_id, 'view'));

drop policy if exists title_reviews_select on public.title_reviews;
create policy title_reviews_select on public.title_reviews for select to authenticated
  using (public.gc_can(auth.uid(), 'view') or public.member_can(auth.uid(), org_id, 'view'));

-- GC-only tables. Reads for all four roles; vendor writes are operational.
drop policy if exists export_records_select on public.export_records;
create policy export_records_select on public.export_records for select to authenticated
  using (public.gc_can(auth.uid(), 'view'));

drop policy if exists works_select on public.works;
create policy works_select on public.works for select to authenticated
  using (public.gc_can(auth.uid(), 'view'));

drop policy if exists portal_links_select on public.portal_links;
create policy portal_links_select on public.portal_links for select to authenticated
  using (public.gc_can(auth.uid(), 'view'));

drop policy if exists portal_otps_select on public.portal_otps;
create policy portal_otps_select on public.portal_otps for select to authenticated
  using (public.gc_can(auth.uid(), 'view'));

drop policy if exists portal_sessions_select on public.portal_sessions;
create policy portal_sessions_select on public.portal_sessions for select to authenticated
  using (public.gc_can(auth.uid(), 'view'));

drop policy if exists portal_access_events_select on public.portal_access_events;
create policy portal_access_events_select on public.portal_access_events for select to authenticated
  using (public.gc_can(auth.uid(), 'view'));

drop policy if exists screener_view_events_select on public.screener_view_events;
create policy screener_view_events_select on public.screener_view_events for select to authenticated
  using (public.gc_can(auth.uid(), 'view'));

drop policy if exists vendors_select on public.vendors;
create policy vendors_select on public.vendors for select to authenticated
  using (public.gc_can(auth.uid(), 'view'));

drop policy if exists vendors_insert on public.vendors;
create policy vendors_insert on public.vendors for insert to authenticated
  with check (public.gc_can(auth.uid(), 'operate'));

drop policy if exists vendors_update on public.vendors;
create policy vendors_update on public.vendors for update to authenticated
  using (public.gc_can(auth.uid(), 'operate'))
  with check (public.gc_can(auth.uid(), 'operate'));

-- gc_staff_select: NOT CHANGED. Identity read, deliberately at membership level. See header.

-- ----------------------------------------------------------------------------
-- 5. Functions. Each body is otherwise untouched — only the authorization expression
--    `public.is_gc_staff(auth.uid())` becomes `public.gc_can(auth.uid(), '<capability>')`.
--    Generated from pg_get_functiondef against the live schema rather than hand-copied, so
--    no body can drift from what was actually deployed.
--
--    12 take 'operate' (delivery, review, exports, portal links, creating notifications,
--    release dates). 3 take 'view' — org_notification_recipients and screener_engagement are
--    reads, and mark_notifications_read writes only the caller's own read-state (header).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_delivery(p_title_id uuid, p_vendor_id uuid, p_grant_id uuid, p_territory text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not public.gc_can(auth.uid(), 'operate') then raise exception 'Not authorized'; end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.create_notification(p_org_id uuid, p_kind notification_kind, p_title text, p_body text, p_source_refs jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.gc_can(auth.uid(), 'operate') then raise exception 'Not authorized'; end if;
  insert into public.notifications (org_id, kind, sender, title, body, source_refs, created_by)
  values (p_org_id, p_kind, 'gc_support', p_title, p_body, coalesce(p_source_refs, '{}'::jsonb), auth.uid())
  returning id into v_id;
  return v_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.create_portal_link(p_delivery_id uuid, p_asset_id uuid, p_token_hash text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_title uuid; v_status public.title_status; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.gc_can(auth.uid(), 'operate') then raise exception 'Not authorized'; end if;

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
$function$
;

CREATE OR REPLACE FUNCTION public.create_screener_link(p_title_id uuid, p_token_hash text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_share_token text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_source public.screener_source; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.gc_can(auth.uid(), 'operate') then raise exception 'Not authorized'; end if;
  select screener_source into v_source from public.titles where id = p_title_id;
  if not found then raise exception 'Title not found'; end if;
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

  -- Single active link per title: withdraw any live screener link before minting the new one.
  -- (This is the "reset" — the previously-shared URL stops resolving in the portal.)
  update public.portal_links
     set revoked_at = now()
   where title_id = p_title_id and purpose = 'screener_view' and revoked_at is null;

  insert into public.portal_links (purpose, title_id, token_hash, share_token, created_by, expires_at)
  values ('screener_view', p_title_id, btrim(p_token_hash), p_share_token, auth.uid(),
          coalesce(p_expires_at, now() + interval '14 days'))
  returning id into v_id;
  return v_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.link_title_to_work_of(p_title_id uuid, p_target_title_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_work uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.gc_can(auth.uid(), 'operate') then raise exception 'Not authorized'; end if;
  if p_title_id = p_target_title_id then raise exception 'A title cannot be linked to itself'; end if;
  if not exists (select 1 from public.titles where id = p_title_id) then raise exception 'Title not found'; end if;
  select work_id into v_work from public.titles where id = p_target_title_id;
  if not found then raise exception 'Target title not found'; end if;
  if v_work is null then
    insert into public.works (created_by) values (auth.uid()) returning id into v_work;
    update public.titles set work_id = v_work where id = p_target_title_id;
  end if;
  update public.titles set work_id = v_work where id = p_title_id;
  return v_work;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.notification_reads (notification_id, user_id)
  select n.id, auth.uid()
  from public.notifications n
  where n.id = any (p_ids)
    and (public.gc_can(auth.uid(), 'view') or public.member_can(auth.uid(), n.org_id, 'view'))
  on conflict (notification_id, user_id) do nothing;
end; $function$
;

CREATE OR REPLACE FUNCTION public.org_notification_recipients(p_org_id uuid)
 RETURNS SETOF text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.gc_can(auth.uid(), 'view') then raise exception 'Not authorized'; end if;
  return query
    select u.email::text
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
      and m.status = 'active'
      and u.email is not null;
end; $function$
;

CREATE OR REPLACE FUNCTION public.reconcile_title_findings(p_org_id uuid, p_title_id uuid, p_findings jsonb, p_logic_version text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f jsonb;
  v_codes text[] := '{}';
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not (public.gc_can(auth.uid(), 'operate') or public.member_can(auth.uid(), p_org_id, 'operate')) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from public.titles where id = p_title_id and org_id = p_org_id) then
    raise exception 'Title not found in this organization';
  end if;

  for f in select * from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) loop
    v_codes := array_append(v_codes, f->>'code');
    insert into public.findings
      (org_id, entity_type, entity_id, code, source, sender, severity, message,
       source_refs, logic_version, derived_at, status, resolved_at)
    values
      (p_org_id, 'title', p_title_id, f->>'code', 'validator', 'gc_support',
       (f->>'severity')::public.finding_severity, f->>'message',
       jsonb_build_object('title_id', p_title_id, 'field', f->>'field', 'tier', f->>'tier'),
       p_logic_version, now(), 'open', null)
    on conflict (entity_type, entity_id, code, source) do update
      set status = 'open', resolved_at = null,
          severity = excluded.severity, message = excluded.message,
          source_refs = excluded.source_refs, logic_version = excluded.logic_version,
          derived_at = excluded.derived_at;
  end loop;

  -- auto-resolve validator findings for this title that are no longer present
  update public.findings
    set status = 'resolved', resolved_at = now()
    where entity_type = 'title' and entity_id = p_title_id and source = 'validator'
      and status = 'open' and not (code = any (v_codes));
end; $function$
;

CREATE OR REPLACE FUNCTION public.record_export(p_vendor_id uuid, p_title_ids uuid[], p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_bad uuid[];
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.gc_can(auth.uid(), 'operate') then raise exception 'Not authorized'; end if;

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
$function$
;

CREATE OR REPLACE FUNCTION public.review_title(p_title_id uuid, p_decision review_decision, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.gc_can(auth.uid(), 'operate') then
    raise exception 'Only GC staff can review titles';
  end if;
  if p_decision = 'reject' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to reject';
  end if;

  select org_id into v_org from public.titles where id = p_title_id and status = 'in_review';
  if v_org is null then
    raise exception 'Title not found or not in review';
  end if;

  update public.titles
    set status = case when p_decision = 'approve' then 'in_delivery'::public.title_status
                      else 'draft'::public.title_status end
    where id = p_title_id;

  insert into public.title_reviews (title_id, org_id, reviewer, decision, reason)
    values (p_title_id, v_org, auth.uid(), p_decision, nullif(btrim(p_reason), ''));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.revoke_portal_link(p_link_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.gc_can(auth.uid(), 'operate') then raise exception 'Not authorized'; end if;
  update public.portal_links set revoked_at = coalesce(revoked_at, now()) where id = p_link_id;
  if not found then raise exception 'Link not found'; end if;
end; $function$
;

CREATE OR REPLACE FUNCTION public.revoke_portal_session(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_found uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.gc_can(auth.uid(), 'operate') then raise exception 'Not authorized'; end if;

  update public.portal_sessions
     set revoked_at = coalesce(revoked_at, now())
   where id = p_session_id
  returning id into v_found;

  if v_found is null then raise exception 'Session not found'; end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.screener_engagement(p_link_id uuid)
 RETURNS TABLE(session_id uuid, name text, company text, email text, watched_pct integer, completed boolean, replays integer, last_viewed timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.id, s.name, s.company, s.email,
         coalesce(round(100.0 * max(e.position_seconds) / nullif(max(e.runtime_seconds), 0)), 0)::int,
         bool_or(e.event_type = 'ended')
           or coalesce(round(100.0 * max(e.position_seconds) / nullif(max(e.runtime_seconds),0)),0) >= 95,
         greatest(count(*) filter (where e.event_type = 'ended') - 1, 0)::int,
         max(e.occurred_at)
  from public.portal_sessions s
  join public.screener_view_events e on e.session_id = s.id
  where e.link_id = p_link_id and public.gc_can(auth.uid(), 'view')
  group by s.id, s.name, s.company, s.email;
$function$
;

CREATE OR REPLACE FUNCTION public.set_delivery_status(p_delivery_id uuid, p_status delivery_status, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_title uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.gc_can(auth.uid(), 'operate') then raise exception 'Not authorized'; end if;

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
$function$
;

CREATE OR REPLACE FUNCTION public.set_release_date(p_title_id uuid, p_date date DEFAULT NULL::date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.gc_can(auth.uid(), 'operate') then raise exception 'Not authorized'; end if;
  update public.titles set release_date = p_date where id = p_title_id;
  if not found then raise exception 'Title not found'; end if;
end;
$function$
;


-- ----------------------------------------------------------------------------
-- 6. Prove it at apply time rather than trusting the statements above.
-- ----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  -- The capability matrix, asserted directly against gc_can rather than inferred.
  if     public.gc_can(null, 'view')            then raise exception 'gc_can(null) must be false'; end if;

  -- Nothing may still hold a bare is_gc_staff authorization gate except the identity read.
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc like '%is_gc_staff%'
    and p.proname not in ('is_gc_staff', 'member_can');
  if v_bad is not null then
    raise exception 'functions still gating on bare is_gc_staff: %', v_bad;
  end if;

  select string_agg(tablename||'.'||policyname, ', ') into v_bad
  from pg_policies
  where schemaname = 'public' and tablename <> 'gc_staff'
    and (coalesce(qual,'') like '%is_gc_staff%' or coalesce(with_check,'') like '%is_gc_staff%')
    and coalesce(qual,'')||coalesce(with_check,'') not like '%gc_can%';
  if v_bad is not null then
    raise exception 'policies still gating on bare is_gc_staff: %', v_bad;
  end if;

  -- member_can must delegate, not short-circuit.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='member_can' and p.prosrc like '%gc_can(p_uid, p_capability)%'
  ) then
    raise exception 'member_can still short-circuits GC staff to true';
  end if;

  -- 20260726000400's revoke must survive this file's CREATE OR REPLACE of member_can.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
    lateral unnest(p.proacl) a
    where n.nspname='public' and p.proname in ('member_can','gc_can') and a::text like '=%'
  ) then
    raise exception 'member_can or gc_can carries a PUBLIC execute grant';
  end if;

  raise notice 'gc_role now decides: gc_can in place, member_can delegates, 15 policies and 15 functions repointed';
end $$;

-- ----------------------------------------------------------------------------
-- LESSON, recorded because it nearly produced a wrong change here: "which roles can write?"
-- cannot be answered from `pg_policies` alone. The query that reported
-- "WRITE policies reachable by viewer: NONE" was true and incomplete in the same breath —
-- `mark_notifications_read` is a SECURITY DEFINER function carrying its own authorization,
-- so it is a write path no policy audit will ever surface.
--
-- Next time, enumerate BOTH: non-SELECT policies, and SECURITY DEFINER functions whose guard
-- admits the role in question. The second list is where the surprises live.
-- ----------------------------------------------------------------------------
