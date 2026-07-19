-- ============================================================================
-- 20260719000100_title_reviews.sql
--
-- INTENT: The §11 in_review chain-of-title gate + the first GC-side write.
--   submit_title: client (operate) moves a title draft -> in_review.
--   review_title: GC staff (is_gc_staff, all orgs) approves (-> in_delivery) or
--     rejects (-> draft, reason required); each decision is an append-only
--     title_reviews row. The gate is NARROW: status + capability only, no
--     metadata/QC/rights re-check (§11). titles.status changes only via these
--     definer RPCs (no client/GC direct UPDATE path).
--
-- DELIBERATELY EXCLUDED (seams): chain-of-title evidence capture, notifications,
-- takedown transitions, asset-purge cron, GC dashboard/root-routing.
--
-- DESTRUCTIVE OPS (approved before apply): audit trigger on title_reviews;
-- REVOKE INSERT/UPDATE/DELETE on title_reviews. Forward-only + idempotent.
-- ============================================================================

do $$ begin
  create type public.review_decision as enum ('approve','reject');
exception when duplicate_object then null; end $$;

create table if not exists public.title_reviews (
  id         uuid primary key default gen_random_uuid(),
  title_id   uuid not null references public.titles(id)        on delete restrict,
  org_id     uuid not null references public.organizations(id) on delete restrict,
  reviewer   uuid references auth.users(id) on delete set null,   -- the gc_staff actor
  decision   public.review_decision not null,
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists title_reviews_title_idx on public.title_reviews (title_id);
create index if not exists title_reviews_org_idx   on public.title_reviews (org_id);

drop trigger if exists audit_title_reviews on public.title_reviews;
create trigger audit_title_reviews after insert or update or delete on public.title_reviews
  for each row execute function public.tg_audit();

alter table public.title_reviews enable row level security;
revoke all on public.title_reviews from anon;

-- Client sees its own title's reviews; GC sees all (scope inverts, §22).
drop policy if exists title_reviews_select on public.title_reviews;
create policy title_reviews_select on public.title_reviews for select to authenticated
  using (public.is_gc_staff(auth.uid()) or public.member_can(auth.uid(), org_id, 'view'));
-- Writes only via review_title(); immutable.
revoke insert, update, delete on public.title_reviews from authenticated, service_role;

-- submit_title: client (operate) draft -> in_review.
create or replace function public.submit_title(p_org_id uuid, p_title_id uuid)
  returns void
  language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized to submit titles for this organization';
  end if;
  update public.titles
    set status = 'in_review'
    where id = p_title_id and org_id = p_org_id and status = 'draft';
  if not found then
    raise exception 'Title not found in this organization, or not in draft';
  end if;
end;
$$;

revoke execute on function public.submit_title(uuid, uuid) from public, anon;
grant  execute on function public.submit_title(uuid, uuid) to authenticated;

-- review_title: GC only. Approve -> in_delivery, reject -> draft (+ reason).
create or replace function public.review_title(
  p_title_id uuid,
  p_decision public.review_decision,
  p_reason   text
) returns void
  language plpgsql security definer set search_path = public
as $$
declare v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_gc_staff(auth.uid()) then
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
$$;

revoke execute on function public.review_title(uuid, public.review_decision, text) from public, anon;
grant  execute on function public.review_title(uuid, public.review_decision, text) to authenticated;
