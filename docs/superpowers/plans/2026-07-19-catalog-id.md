# Internal catalog ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every title an immutable, human-friendly internal catalog ID (`GC-0001234`) assigned automatically at creation.

**Architecture:** A dedicated Postgres sequence provides an immutable `titles.catalog_no bigint`; an `IMMUTABLE` Damm-check-digit function feeds a `GENERATED ... STORED` `titles.catalog_id` display column (`GC-` + 6-digit zero-pad + check digit). A BEFORE-UPDATE trigger makes `catalog_no` immutable. The ID is shown on the title detail + titles list.

**Tech Stack:** Supabase Postgres (sequence, generated column, plpgsql, pgTAP), Next.js App Router (server components), TypeScript strict, Tailwind + GC tokens.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-19-catalog-id-design.md`.
- **Branch:** `feat/catalog-id` off `main` (`2399525`). Merges before B-work (which displays `catalog_id` on `/gc/review`).
- **Migration filename:** `supabase/migrations/20260719000400_catalog_id.sql` (sorts after `…000300`).
- **Format (founder-decided, do not change):** `GC-` + `lpad(catalog_no,6,'0')` + one **Damm** check digit, e.g. `GC-0001234`. Sequential, no encoded meaning, immutable, never reused.
- **`gc_check_digit` must be `IMMUTABLE`** (a generated column may only call immutable functions). Damm anchors: `gc_check_digit(572)=4`, `gc_check_digit(5724)=0`.
- **`catalog_no` is immutable** (trigger-guarded) and **client-unwritable** (default-assigned only; `catalog_id` is `GENERATED`, so Postgres forbids direct writes to it).
- **Out of scope:** showing `catalog_id` on `/gc/review` (B-work); lookup/search by ID + its input-normalization helper.
- **Conventions:** UUID/`bigint`/`timestamptz`/`snake_case`; regenerate `database.types.ts` after the migration (strip leaked CLI lines); design tokens; TS strict.
- **Destructive-ops (approved before apply):** create function + create trigger + alter table add columns. Founder runs the apply (`supabase db reset`) + `gen types`.

---

### Task 1: Migration — sequence, Damm check digit, `catalog_no` + generated `catalog_id`, immutability

**Files:**
- Create: `supabase/migrations/20260719000400_catalog_id.sql`
- Modify (founder-run regen): `src/lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: `public.titles`.
- Produces: `public.gc_check_digit(bigint) returns int` (IMMUTABLE); `titles.catalog_no bigint not null` (unique); `titles.catalog_id text` (generated, unique).

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Show destructive SQL (function + trigger + add columns) for approval; founder applies + regenerates**

```
! supabase db reset
! supabase gen types typescript --local > src/lib/supabase/database.types.ts
```
Then strip any leaked CLI lines; verify the file starts with `export type Json =`, ends with `} as const`, and that the `titles` Row now includes `catalog_no: number` and `catalog_id: string`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260719000400_catalog_id.sql src/lib/supabase/database.types.ts
git commit -m "feat(db): titles.catalog_id (GC-0001234, Damm check digit) + immutable catalog_no"
```

---

### Task 2: pgTAP — Damm anchors, auto-assignment, format, uniqueness, immutability

**Files:**
- Create: `supabase/tests/catalog_id_test.sql`

**Interfaces:**
- Consumes: `public.gc_check_digit`, `titles.catalog_no`, `titles.catalog_id` (Task 1).

- [ ] **Step 1: Write the test**

```sql
-- catalog_id_test.sql
-- Catalog ID: Damm check-digit anchors, auto-assignment, format, uniqueness, immutability.

begin;
select plan(7);

select set_config('t.org', gen_random_uuid()::text, false);
insert into public.organizations (id, name) values (current_setting('t.org')::uuid, 'Org Cat');

-- Damm check digit — documented anchors (payload → check; full number → 0 = valid)
select is(public.gc_check_digit(572), 4, 'Damm(572) = 4');
select is(public.gc_check_digit(5724), 0, 'Damm(5724) = 0 (valid)');

-- auto-assignment + format on insert
select set_config('t.t1', gen_random_uuid()::text, false);
insert into public.titles (id, org_id, title)
  values (current_setting('t.t1')::uuid, current_setting('t.org')::uuid, 'Cat Title One');
select set_config('t.t2', gen_random_uuid()::text, false);
insert into public.titles (id, org_id, title)
  values (current_setting('t.t2')::uuid, current_setting('t.org')::uuid, 'Cat Title Two');

select matches(
  (select catalog_id from public.titles where id = current_setting('t.t1')::uuid),
  '^GC-\d{7}$', 'catalog_id formatted GC- + 7 digits');

-- the generated check digit validates: Damm of (catalog_no*10 + check) = 0
select is(
  public.gc_check_digit(
    (select catalog_no from public.titles where id = current_setting('t.t1')::uuid) * 10
    + right((select catalog_id from public.titles where id = current_setting('t.t1')::uuid), 1)::int),
  0, 'catalog_id check digit validates (Damm full number = 0)');

-- monotonic, distinct
select ok(
  (select catalog_no from public.titles where id = current_setting('t.t2')::uuid)
  > (select catalog_no from public.titles where id = current_setting('t.t1')::uuid),
  'catalog_no increases across inserts');

-- immutability guard
select throws_ok(
  $$ update public.titles set catalog_no = 999999 where id = current_setting('t.t1')::uuid $$,
  'P0001', 'catalog_no is immutable', 'catalog_no cannot be changed');

-- generated column cannot be written directly (Postgres error 428C9)
select throws_ok(
  $$ update public.titles set catalog_id = 'GC-9999999' where id = current_setting('t.t1')::uuid $$,
  '428C9', null, 'catalog_id (generated) cannot be written directly');

select * from finish();
rollback;
```

> Note: `plan(7)` counts the seven `is/matches/ok/throws_ok` checks (the two `throws_ok` are the 6th and 7th). If the harness reports a count mismatch, align `plan(N)` to the actual number of check calls — do not remove a real assertion.

- [ ] **Step 2: Run** — `supabase test db` → `catalog_id_test.sql ... ok` and `All tests successful.`

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/catalog_id_test.sql
git commit -m "test(db): catalog ID — Damm anchors, auto-assign, format, uniqueness, immutability"
```

---

### Task 3: Display the catalog ID (title detail + titles list)

**Files:**
- Modify: `src/app/(app)/titles/[id]/page.tsx`
- Modify: `src/app/(app)/titles/page.tsx`

**Interfaces:**
- Consumes: `titles.catalog_id` (Task 1).

- [ ] **Step 1: Title detail — select + show the ID** (`src/app/(app)/titles/[id]/page.tsx`)

Add `catalog_id` to the title query (the `.select(...)` at line ~65):

```tsx
  const { data: title } = await supabase
    .from("titles")
    .select("id, title, status, org_id, catalog_id")
    .eq("id", id)
    .maybeSingle();
```

Render the ID as a muted line at the top of the status block. Change the block that starts
`<div className="mb-6 flex flex-col gap-3">` (line ~117) so its first child is the catalog ID:

```tsx
      <div className="mb-6 flex flex-col gap-3">
        <p className="t-body-sm text-ink-3">{title.catalog_id}</p>
        <p className="t-body-sm text-ink-2">
          Status: <span className="font-medium text-ink">{TITLE_STATUS_LABELS[title.status]}</span>
        </p>
```
(Leave the rest of the block — rejection notice, submit button — unchanged.)

- [ ] **Step 2: Titles list — select + show the ID** (`src/app/(app)/titles/page.tsx`)

Add `catalog_id` to the list query (line ~48):

```tsx
  const { data: titles } = await supabase
    .from("titles")
    .select("id, title, status, created_at, catalog_id")
    .eq("org_id", activeOrg.id)
    .order("created_at", { ascending: false });
```

Show it in the muted sub-line of each card. Change the "Added …" span (lines ~84-86) to:

```tsx
                    <span className="t-body-sm text-ink-3">
                      {t.catalog_id} · Added {fmt.format(new Date(t.created_at))}
                    </span>
```

- [ ] **Step 3: Typecheck + lint + build** — `npm run typecheck && npm run lint && npm run build` → green.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/titles
git commit -m "feat(catalog): show catalog ID on title detail + titles list"
```

---

### Task 4: Verify end-to-end

**Files:** none.

- [ ] **Step 1: Full DB suite** — `supabase test db` → `All tests successful.` (incl. `catalog_id_test.sql`).
- [ ] **Step 2: App checks** — `npm run typecheck && npm run lint && npm run build` → green.
- [ ] **Step 3: Leak-check** — invoke the `leak-check` skill (no new secrets; confirm clean).
- [ ] **Step 4: Manual (founder).** Create a title → its detail page and the titles list show a `GC-…` ID; editing the title (e.g. adding rights) does not change the ID.
- [ ] **Step 5: Commit any fixups** — `git add -A && git commit -m "chore(catalog): verification fixups"`.

---

## Self-Review

**1. Spec coverage:**
- Dedicated sequence + `catalog_no` (immutable, unique, default-assigned) → Task 1 ✓
- `gc_check_digit` Damm, IMMUTABLE → Task 1 ✓ (anchors tested Task 2)
- `catalog_id` generated display (`GC-` + 6-pad + check) + unique → Task 1 ✓
- Immutability trigger on `catalog_no` → Task 1 ✓ (tested Task 2)
- Display on title detail + titles list → Task 3 ✓
- `/gc/review` display + lookup/search → out of scope (B-work / later) ✓

**2. Placeholder scan:** No TBD/TODO. Full SQL (incl. the complete Damm table as a flat 100-element array indexed `interim*10+d+1`), full pgTAP with documented anchors, exact UI edits. All code complete.

**3. Type consistency:** `catalog_id` (text→TS `string`) and `catalog_no` (bigint→TS `number`) added to both title selects (Task 3) match the columns (Task 1). The generated-column write-rejection test uses SQLSTATE `428C9`; the immutability test uses `P0001` + message `catalog_no is immutable` matching the trigger's `raise`.
