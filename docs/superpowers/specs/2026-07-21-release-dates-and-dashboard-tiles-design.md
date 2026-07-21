# Release dates + portfolio Dashboard tiles — design

**Date:** 2026-07-21
**Status:** Approved (design), pending migration-SQL sign-off
**Branch:** `feat/release-dates-and-dashboard-tiles`

## Goal

Give the client Dashboard a **portfolio snapshot** — how many titles, revenue (as a
seam until statements land), and a **release pipeline** (upcoming / new / just-in). The
pipeline needs a real per-title release date, which the data model does not yet have. So
this is two slices:

- **Slice A — release-date model** (prerequisite): add release type + two dates to titles,
  collect them at intake, let GC set the re-release date, enforce in RLS, record in the
  domain spec, migrate + backfill.
- **Slice B — Dashboard tiles**: read Slice A + existing tables and render the snapshot.

Both slices ship together on this branch (founder: "do it all").

---

## Slice A — release-date model

### The model

At **upload**, the client chooses a **release type** and enters the **original release date**:

- **New release** → the title has not been distributed before. The original release date
  *is* its upcoming/first release (may be in the future).
- **Re-release** → the original release date is historical; **GC staff** later set a
  **re-release date** (the upcoming distribution date).

The Dashboard's effective **"release date" is the *later* of `original_release_date` and
`re_release_date`** (nulls ignored). So a new release shows its original date; a re-release
shows the GC-set re-release date. `Upcoming` = that date is in the future; `New` = it is
recently in the past.

### Fields (on `public.titles`)

| Field | Type | Writer | Rule |
|---|---|---|---|
| `release_type` | enum `new_release \| re_release` | Client, at intake | Required for new titles |
| `original_release_date` | `date` | Client, at intake | Required for new titles; retires the `release_year` metadata field |
| `re_release_date` | `date`, nullable | **GC staff only** | Null until GC sets it; RLS-enforced |

**Design calls (approved):**
1. `original_release_date` is a **first-class `titles` column**, not a JSONB metadata key —
   it drives operational logic (the pipeline) and pairs with `release_type` /
   `re_release_date`. It still appears in the metadata form UX. Retires `release_year`.
2. `re_release_date` is **GC-write / client-read, enforced in RLS** (golden rule 12/10 —
   a client editing a distribution date is a correctness/authority risk), via a
   `set_re_release_date` SECURITY DEFINER RPC gated on `is_gc_staff` (mirrors
   `set_delivery_status`).

### Write paths (RPCs — house pattern: mutations are RPCs)

- **`create_title(p_org_id, p_title, p_release_type, p_original_release_date)`** — extend the
  existing RPC. All four args **required** (no DEFAULT — we *want* TS to force them; the
  known-gotcha only applies to args we intend to omit). Drop the old 2-arg overload first so
  no ambiguous overload lingers. Raise if `p_release_type`/`p_original_release_date` missing.
- **`set_title_release_info(p_org_id, p_title_id, p_release_type, p_original_release_date)`** —
  new, **client** (`member_can(...,'operate')`), for edits from the metadata/title form.
- **`set_re_release_date(p_title_id, p_date date default null)`** — new, **GC-only**
  (`is_gc_staff`), mirrors `set_delivery_status`. `default null` so it is omittable/clearable.

### Backfill

Existing titles carry `release_year` (a year, in `title_metadata.data`). Backfill
`original_release_date = make_date(year,1,1)` where a 4-digit year exists (regex-guarded).
`release_type` defaults to `new_release` (the existing catalog was originally released).
`re_release_date` stays null. Titles with no valid `release_year` keep a null
`original_release_date` (legacy drafts) — enforced-required only on new writes.

### App changes (Slice A)

- **New-title / intake form** gains a **release type** selector + **original release date**
  input; passes them to `create_title`. (Founder checkpoint: form copy/layout.)
- **`lib/metadata.ts`** — remove `release_year` from `METADATA_FIELDS` (retired). Adjust the
  required-completeness count + the metadata validator accordingly. Release fields are edited
  via `set_title_release_info`, not the JSONB blob.
- **GC title detail** (`app/gc/titles/[id]`) — add a GC-only **re-release date** control
  (calls `set_re_release_date`), shown for `release_type = re_release` (settable regardless,
  but surfaced primarily for re-releases).
- **`docs/domain-spec.md`** — record the release-date model in the same PR (golden rule /
  CLAUDE.md: decisions not in the spec get written to the spec).
- Regenerate `src/lib/supabase/database.types.ts`.

---

## Slice B — portfolio Dashboard tiles

### Effective release date (shared helper, `lib/releases.ts`)

```
effectiveReleaseDate(t) = max(original_release_date, re_release_date)   // nulls ignored, null if both null
```

Buckets (constants in `lib/releases.ts`, adjustable):
- **Upcoming** — `effectiveReleaseDate > today`
- **New releases** — `today - RELEASE_NEW_WINDOW_DAYS <= effectiveReleaseDate <= today` (default 30d)
- **Just in** (recent acquisitions) — `created_at >= today - JUST_IN_WINDOW_DAYS` (default 30d); independent of release date

### Tiles

1. **Catalog** — total titles; meta: `N live · M in review`. Links to `/titles`.
2. **Revenue** — placeholder seam: value `—`, meta "Arrives with statements". No number, no link (until the module lands).
3. **Upcoming releases** — count of upcoming; meta: `next: <date>`. Links to `/titles` (filtered later).
4. **New releases** — count in the new window; meta: window label.
5. **Just in** — a compact recent-acquisitions **list** (title + date added) below the KPI row, since it's naturally a list, not a single number.

Retained from PR #19 (below the tiles): the **Catalog Health attention pointer** + the
**org summary** card. Findings stay owned by the Catalog Health page — the Dashboard only
points there.

### Layout (founder checkpoint — visual)

KPI strip, 4 across: **Catalog · Revenue · Upcoming · New releases**; then the **Just in**
list; then the attention pointer + org summary. Chosen for scan-density; adjustable — this is
a visual decision the founder signs off on.

### Primitive

New shared **`StatTile`** (`src/components/dashboard/stat-tile.tsx`):
`{ label, value, meta?, href?, tone? }`, built on `.card-surface` + `.stat-card` tokens,
`tabular-nums` for the number. Server-component-safe (no client hooks). Shared so the future
**GC aggregate Dashboard** reuses it unchanged (same reads, `is_gc_staff` scope).

### Data reads (server component, per the established pattern)

- Titles + release fields + status + created_at: `titles` (org-scoped by RLS).
- Counts computed in the server component (catalog sizes don't justify aggregate RPCs yet —
  revisit if they grow).
- Revenue: none (placeholder).

---

## Testing / verification

- **DB (pgTAP or SQL):** `set_re_release_date` rejects a non-GC caller; a client cannot write
  `re_release_date`; `create_title` requires the new args; backfill maps `release_year` → date.
- **Unit (Vitest):** `effectiveReleaseDate` + bucket logic (new/upcoming/just-in) across
  edge cases (both null, original only, re-release later/earlier, boundary dates).
- **Manual:** create a new-release title (future date → shows Upcoming); mark a title
  re-release + GC sets a re-release date → shows Upcoming with the GC date; verify the client
  cannot edit `re_release_date`.
- `pnpm typecheck && pnpm lint && pnpm test` green before PR.

## Out of scope (seams, not built)

Revenue numbers (statements module), per-platform/per-window release dates, GC aggregate
Dashboard, `/titles` release-filtered views. Designed so each drops in later without rework.

## Sequencing

Slice A (migration → SQL approval → apply → app + spec + types) **then** Slice B (helper +
tiles + tests). One PR on this branch.
