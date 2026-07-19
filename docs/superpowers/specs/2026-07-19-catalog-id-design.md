# Internal catalog ID — design (slice: catalog-id)

> Status: design approved (founder-decided format, 2026-07-19). Small slice; brainstorm skipped —
> the design was settled in conversation. Source of truth for *what*: this doc. Inserted before B-work
> ([[2026-07-19-work-identity-design]]) so `/gc/review` can display the ID in that slice.

## Context

Every title needs a stable, human-friendly **internal GC catalog ID** that GC staff reference for the
title's whole life — in vendor portals, delivery emails, and support (§13 delivery is manual, so
humans type/paste this ID into external systems). It is assigned automatically at title creation and
never changes. This is a per-**title** identifier (distinct from a `works` id): the same underlying
work brought by two clients is two titles with two catalog IDs.

## Format (founder-decided)

**`GC-0001234`** — `GC-` prefix, one dash, a 6-digit zero-padded sequential number, and a trailing
single **Damm check digit**.

- **Sequential**, from a dedicated Postgres sequence — ordered, readable, operations-friendly. (Chosen
  over an opaque code: this is an internal ID behind auth; readability for the manual-delivery workflow
  beats hiding the catalog count.)
- **No encoded meaning** — no year/pillar/type in the key. Smart IDs rot; meaning lives in columns.
- **Damm check digit** — a single digit that detects all single-digit errors and all adjacent
  transpositions (better than Luhn for transposition-heavy manual entry). Canonical anchor: Damm(572) = 4.
- **6 digits** covers ~1M titles (catalog is 700+ today); the format widens gracefully past 999,999
  (lpad only pads, never truncates).
- **Normalize on input** (future lookup): strip non-alphanumerics + uppercase, so `gc0001234`,
  `GC 0001234`, `GC-0001234` all resolve. (Lookup/search itself is out of scope here.)
- **Immutable and never reused** — kept even after takedown (nothing is ever deleted).

## Scope

**In:**
- A dedicated sequence + immutable `gc_check_digit(bigint)` Damm function.
- `titles.catalog_no bigint not null default nextval(...)` (unique) — assigned on insert; backfills any
  existing rows via the volatile default on `ALTER ADD COLUMN`.
- `titles.catalog_id text GENERATED ALWAYS AS ('GC-' || lpad(catalog_no,6,'0') || gc_check_digit(catalog_no)) STORED` (unique) — the display form, always consistent.
- Immutability guard: a trigger raising if `catalog_no` is ever changed on UPDATE.
- Display `catalog_id` on the **title detail** header and the **titles list** (client-facing, own data).
- Regenerate `database.types.ts`; pgTAP; app checks.

**Out (seams):**
- Showing `catalog_id` on **`/gc/review`** — done in **B-work** (that slice overhauls the review card;
  keeping the change there avoids touching it twice).
- **Lookup/search by catalog ID** (and the input-normalization helper it needs) — later, when search lands.
- Any client-editability — the ID is system-assigned only.

## Key decisions

- **Store the immutable integer (`catalog_no`) as the source of truth; derive the display string** via a
  `GENERATED ... STORED` column. The number never changes, so the ID is stable; the format lives in one
  place (the generated expression + `gc_check_digit`).
- **`gc_check_digit` must be `IMMUTABLE`** so the generated column can call it.
- **Damm over Luhn** — single digit, catches all adjacent transpositions (a common typo when entering
  IDs into vendor portals).
- **Assignment via a column default `nextval`** — concurrency-safe, gapless not required (rollbacks may
  leave gaps; that's fine for an opaque-of-meaning ID).

## Data model (shape; exact SQL in the plan)

```sql
create sequence public.titles_catalog_seq;
create function public.gc_check_digit(p_n bigint) returns int language plpgsql immutable ...; -- Damm
alter table public.titles
  add column catalog_no bigint not null default nextval('public.titles_catalog_seq');
alter table public.titles
  add column catalog_id text generated always as
    ('GC-' || lpad(catalog_no::text, 6, '0') || public.gc_check_digit(catalog_no)::text) stored;
-- unique(catalog_no), unique(catalog_id); BEFORE UPDATE trigger: raise if catalog_no changes.
```
- RLS unchanged (new columns inherit `titles` policies; both are read-only to clients — `catalog_id` is
  generated, `catalog_no` is default-only and guarded).

## Verification

- **pgTAP:** `gc_check_digit(572) = 4` and `gc_check_digit(5724) = 0` (Damm validity); a new title gets a
  `catalog_no` and a well-formed `catalog_id` (`^GC-\d{7}$`); `catalog_no` is unique; updating
  `catalog_no` raises; two inserts get distinct, increasing numbers.
- `typecheck` / `lint` / `build` green; regenerated types compile; leak-check clean.
- Manual: create a title → its detail page and the titles list show a `GC-…` ID; it doesn't change on edit.

## Seams left clean

`catalog_id` is the column B-work's `/gc/review` card renders. The normalization convention (strip +
uppercase) is documented for the future lookup/search feature. `catalog_no` is the stable internal key
other systems (vendor exports, statements) can reference later.
