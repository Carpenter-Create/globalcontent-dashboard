-- ============================================================================
-- 20260726000200_export_records_integrity.sql
--
-- INTENT: close M4's worst case. export_records.title_ids is a bare uuid[] with no
-- referential integrity and record_export validated nothing. Proven live in audit
-- pass 2 (l7-chain-of-title-gate.mjs, Q2f): a call with a randomly generated UUID was
-- accepted and wrote a provenance row referencing a title that does not exist.
--
-- export_records is the immutable answer to "what did GC represent to this endpoint".
-- A provenance row whose subject cannot be resolved is not evidence.
--
-- Postgres cannot put a foreign key on an array element, so this is enforced three ways:
--   1. a CHECK on the column's SHAPE (non-empty, no NULL elements)
--   2. a trigger for existence + duplicates, so the invariant holds on any write path
--   3. an existence/approval check in record_export that names the offending ids
--
-- (3) is the point. M4's complaint was that the linkage is "held only by application
-- convention". A check that lives only in the RPC is still convention — it just moves
-- the convention into SQL. The trigger makes it a property of the table.
--
-- DESTRUCTIVE OPS: adds a CHECK constraint to an existing table (validates existing
-- rows on apply) and creates a trigger. NOTE: the local database currently contains
-- at least one audit-fixture row with a nonexistent title id, deliberately written by
-- the pass-2 harness. The CHECK will pass on it (shape is fine) but the trigger only
-- fires on new writes, so the historical row survives. Clean it up separately if you
-- want the table to be uniformly valid. Forward-only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Shape: a batch must be non-empty and hold no NULL elements.
--    Deliberately NOT the duplicate test here — that needs `select distinct` over
--    unnest, and Postgres rejects a subquery in a CHECK constraint ("cannot use
--    subquery in check constraint"). Duplicates move to the trigger below, which can
--    express them. Keeping the CHECK to what a CHECK can actually enforce.
-- ----------------------------------------------------------------------------
--    cardinality(), NOT array_length(). array_length('{}',1) returns NULL, not 0, and
--    a CHECK passes when its expression is NULL — so `array_length(title_ids,1) >= 1`
--    silently accepts the empty array it was written to reject. Caught by testing the
--    constraint rather than reading it. cardinality() returns 0 and behaves.
alter table public.export_records
  add constraint export_records_title_ids_shape check (
    cardinality(title_ids) >= 1
    and array_position(title_ids, null) is null
  );

-- ----------------------------------------------------------------------------
-- 2. Referential integrity by trigger — the FK Postgres will not give us.
--    SECURITY DEFINER so it sees every org (export is GC-wide) rather than being
--    filtered by the caller's RLS, which would turn a real title into a phantom.
-- ----------------------------------------------------------------------------
create or replace function public.tg_export_records_titles_exist()
  returns trigger
  language plpgsql security definer set search_path = public
as $$
declare v_missing uuid[]; v_distinct int;
begin
  select array_agg(x) into v_missing
  from unnest(new.title_ids) x
  where not exists (select 1 from public.titles t where t.id = x);

  if v_missing is not null and array_length(v_missing, 1) > 0 then
    raise exception 'export_records.title_ids references % title(s) that do not exist: %',
      array_length(v_missing, 1), v_missing
      using errcode = 'foreign_key_violation';
  end if;

  -- Duplicates: the payload is a per-title snapshot, so a repeated id means the
  -- snapshot and the id list disagree about how many titles were sent. Lives here
  -- rather than in the CHECK because expressing it needs a subquery.
  select count(distinct x) into v_distinct from unnest(new.title_ids) x;
  if v_distinct <> cardinality(new.title_ids) then
    raise exception 'export_records.title_ids contains duplicate title ids';
  end if;

  return new;
end;
$$;

drop trigger if exists export_records_titles_exist on public.export_records;
create trigger export_records_titles_exist
  before insert on public.export_records
  for each row execute function public.tg_export_records_titles_exist();

-- ----------------------------------------------------------------------------
-- 3. record_export — normalise the batch and fail with a useful message.
--    Layers on top of 20260726000100's chain-of-title check: that one asks "is every
--    title approved", this one asks "does every title exist". Dedup + sort happen here
--    so the stored array is canonical and two identical exports compare equal.
-- ----------------------------------------------------------------------------
create or replace function public.record_export(
  p_vendor_id uuid, p_title_ids uuid[], p_payload jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ids uuid[]; v_bad uuid[];
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.is_gc_staff(auth.uid()) then raise exception 'Not authorized'; end if;

  if p_title_ids is null or cardinality(p_title_ids) = 0 then
    raise exception 'An export must name at least one title';
  end if;
  if not exists (select 1 from public.vendors where id = p_vendor_id) then
    raise exception 'Vendor % not found', p_vendor_id;
  end if;

  -- Canonical form: distinct, sorted, NULLs dropped.
  select array_agg(distinct x order by x) into v_ids
  from unnest(p_title_ids) x where x is not null;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception 'An export must name at least one title';
  end if;

  -- Integrity (M4): every id must resolve to a real title.
  select array_agg(x) into v_bad
  from unnest(v_ids) x where not exists (select 1 from public.titles t where t.id = x);
  if v_bad is not null and array_length(v_bad, 1) > 0 then
    raise exception 'Export references % title(s) that do not exist: %',
      array_length(v_bad, 1), v_bad
      using errcode = 'foreign_key_violation';
  end if;

  -- Chain of title (L7, 20260726000100): every id must be approved for delivery.
  select array_agg(x) into v_bad
  from unnest(v_ids) x
  where not exists (select 1 from public.titles t where t.id = x and t.status = 'in_delivery');
  if v_bad is not null and array_length(v_bad, 1) > 0 then
    raise exception 'Chain of title: % of % title(s) in this export are not approved for delivery: %',
      array_length(v_bad, 1), array_length(v_ids, 1), v_bad;
  end if;

  insert into public.export_records (vendor_id, title_ids, payload, exported_by)
  values (p_vendor_id, v_ids, p_payload, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.record_export(uuid, uuid[], jsonb) from public, anon;
grant  execute on function public.record_export(uuid, uuid[], jsonb) to authenticated;

-- The trigger function itself is never called directly. Triggers fire regardless of
-- the invoker's EXECUTE privilege (checked at CREATE TRIGGER, not at fire time —
-- verified empirically in audit pass 3), so revoking here costs nothing and keeps it
-- off the list of functions an unprivileged role could attach elsewhere.
revoke execute on function public.tg_export_records_titles_exist() from public, anon, authenticated;
