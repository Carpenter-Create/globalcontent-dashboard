-- ============================================================================
-- 20260719000400_catalog_id.sql
--
-- INTENT: immutable, human-friendly internal catalog ID per title (design
-- 2026-07-19-catalog-id): GC- + 6-digit zero-padded sequential + a Damm check
-- digit, e.g. GC-0001234. catalog_no (bigint, from a dedicated sequence) is the
-- immutable source of truth; catalog_id is a GENERATED display column. Assigned
-- automatically on insert; never changes (trigger-guarded); never reused.
--
-- DESTRUCTIVE OPS (approved before apply): create function, create trigger,
-- alter table add columns. Forward-only.
-- ============================================================================

create sequence if not exists public.titles_catalog_seq;

-- Damm check digit (single digit; detects all single-digit errors and all
-- adjacent transpositions). Standard order-10 Damm operation table. IMMUTABLE so
-- the generated column can call it. Leading zeros are transparent (start state 0).
create or replace function public.gc_check_digit(p_n bigint)
  returns int language plpgsql immutable as $$
declare
  m int[] := array[
    0,3,1,7,5,9,8,6,4,2,
    7,0,9,2,1,5,4,8,6,3,
    4,2,0,6,8,7,1,3,5,9,
    1,7,5,0,9,8,3,4,2,6,
    6,1,2,3,0,4,5,9,7,8,
    3,6,7,4,2,0,9,5,8,1,
    5,8,6,9,7,2,0,1,3,4,
    8,9,4,5,3,6,2,0,1,7,
    9,4,3,8,6,1,7,2,0,5,
    2,5,8,1,4,3,6,7,9,0
  ];  -- flat 100-element table; index = interim*10 + digit (0-based) + 1
  interim int := 0;
  s text := abs(p_n)::text;
  i int;
  d int;
begin
  for i in 1 .. length(s) loop
    d := substr(s, i, 1)::int;
    interim := m[interim * 10 + d + 1];
  end loop;
  return interim;
end;
$$;

alter table public.titles
  add column if not exists catalog_no bigint not null default nextval('public.titles_catalog_seq');
alter sequence public.titles_catalog_seq owned by public.titles.catalog_no;

alter table public.titles
  add column if not exists catalog_id text
  generated always as
    ('GC-' || lpad(catalog_no::text, 6, '0') || public.gc_check_digit(catalog_no)::text) stored;

do $$ begin
  alter table public.titles add constraint titles_catalog_no_key unique (catalog_no);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.titles add constraint titles_catalog_id_key unique (catalog_id);
exception when duplicate_object then null; end $$;

-- catalog_no is immutable once assigned (identifier stability). catalog_id is
-- GENERATED, so Postgres already forbids direct writes to it.
create or replace function public.tg_titles_catalog_no_immutable()
  returns trigger language plpgsql as $$
begin
  if new.catalog_no is distinct from old.catalog_no then
    raise exception 'catalog_no is immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists titles_catalog_no_immutable on public.titles;
create trigger titles_catalog_no_immutable before update on public.titles
  for each row execute function public.tg_titles_catalog_no_immutable();
