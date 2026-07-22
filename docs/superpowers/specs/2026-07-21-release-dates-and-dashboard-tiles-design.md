# Release dates + portfolio Dashboard tiles — design

**Date:** 2026-07-21
**Status:** Approved (design + migration SQL)
**Branch:** `feat/release-dates-and-dashboard-tiles`

## Goal

Give the client Dashboard a **portfolio snapshot** — how many titles, revenue (a seam until
statements land), and a **release pipeline** (upcoming / new / just-in). The pipeline needs a
real per-title release date, which the model does not yet have. Two slices:

- **Slice A — release-date model** (prerequisite): release type + two dates on titles,
  collected/owned per the rule below, enforced in RLS, recorded in the domain spec, migrated
  + backfilled.
- **Slice B — Dashboard tiles**: read Slice A + existing tables and render the snapshot.

Both ship together on this branch.

---

## Slice A — release-date model

### The model (who owns which date)

The forward-looking **go-to-market date is a distribution decision, and distribution is GC's**
(manual, GC-driven; GC/Globee never promise a client a delivery date). So the client only ever
enters a *historical fact they know*; GC always owns the forward date.

- **New release** — client picks the type and enters **no date**. GC sets `release_date`; that
  date is both the original and the upcoming release (they coincide for a first release).
- **Re-release** — client enters `original_release_date` (the historical original). GC later
  sets `release_date` (the upcoming re-release date).

### Fields (on `public.titles`)

| Field | Type | Writer | Rule |
|---|---|---|---|
| `release_type` | enum `new_release \| re_release` | Client, at intake | |
| `original_release_date` | `date`, nullable | **Client — re-release only** | Historical original. Null for new releases. |
| `release_date` | `date`, nullable | **GC only, always** | Go-to-market date. Dashboard shows future ones as "Upcoming". |

**Derived / read rules:**
- **Dashboard release date = `release_date`** (single source, always GC). No "later of two".
- **Authoritative original date** (metadata display) = `COALESCE(original_release_date, release_date)`
  — a new release's original reads as its release date.

**`release_year` is KEPT this PR (not retired).** Discovered during implementation:
`release_year` feeds the vendor export mapping (`export-spec.ts` derives its allowed field keys
from `METADATA_FIELDS`; the standard template maps a "Year" column to it) and the
`suggest_same_work` RPC. The export engine has no source kind for a title *column*, so retiring
`release_year` would require a new export source + resolver + a second RPC migration — vendor-export
blast radius, out of scope here. `original_release_date` is the authoritative *distribution*
original going forward; unifying `release_year` onto it (derive the year + add an export source) is
a fast-follow. No metadata-lib / export / validator changes in this PR.

**Design calls (approved):**
1. Both dates are first-class `titles` columns (drive operational logic; pair with `release_type`).
2. `release_date` is **GC-write only, enforced in RLS** via a `set_release_date` SECURITY DEFINER
   RPC gated on `is_gc_staff` (mirrors `set_delivery_status`). No client write path.

### Write paths (RPCs)

- **`create_title(p_org_id, p_title, p_release_type, p_original_release_date default null)`** —
  extend; drop the old 2-arg overload. `release_type` required; `original_release_date` required
  **iff** `re_release`; never accepts `release_date`.
- **`set_title_release_info(p_org_id, p_title_id, p_release_type, p_original_release_date default null)`**
  — new, client (`member_can 'operate'`), for form edits. Same re-release rule.
- **`set_release_date(p_title_id, p_date date default null)`** — new, **GC-only** (`is_gc_staff`).
  `default null` clears.

### Backfill

Existing catalog is already released: seed **both** `original_release_date` and `release_date`
from `title_metadata.data->>'release_year'` (`make_date(year,1,1)`, regex-guarded, NULLs only).
`release_type` defaults `new_release`.

### App changes (Slice A)

- **New-title / intake form** — add a **release type** selector; show an **original release date**
  input only when *Re-release* is chosen; pass to `create_title`. (Founder checkpoint: copy/layout.)
- **`lib/metadata.ts`** — unchanged (`release_year` kept — see note above).
- **Client title detail** — a release-info section: view type + original date; operators edit via
  `set_title_release_info`.
- **GC title detail** (`app/gc/titles/[id]`) — GC-only **release date** control → `set_release_date`.
- **`docs/domain-spec.md`** — record the release-date model in this PR.
- Regenerate `src/lib/supabase/database.types.ts`.

---

## Slice B — portfolio Dashboard tiles

### Release logic (shared helper, `lib/releases.ts`)

- `effectiveReleaseDate(t) = t.release_date` (the always-GC forward date; null if unset).
- `originalReleaseDate(t) = t.original_release_date ?? t.release_date` (display only).
- Buckets (constants, adjustable): **Upcoming** `release_date > today`; **New releases**
  `today - RELEASE_NEW_WINDOW_DAYS <= release_date <= today` (default 30d); **Just in**
  `created_at >= today - JUST_IN_WINDOW_DAYS` (default 30d; independent of release date).

### Tiles

1. **Catalog** — total titles; meta `N live · M in review`; links `/titles`.
2. **Revenue** — placeholder seam: value `—`, meta "Arrives with statements"; no number, no link.
3. **Upcoming releases** — count upcoming; meta `next: <date>`.
4. **New releases** — count in the new window; meta window label.
5. **Just in** — compact recent-acquisitions **list** (title + date added) below the KPI row.

Retained from PR #19 below the tiles: the **Catalog Health attention pointer** + **org summary**.
Findings stay owned by the Catalog Health page.

### Layout (founder checkpoint — visual)

KPI strip 4-across: **Catalog · Revenue · Upcoming · New releases**; then **Just in**; then the
attention pointer + org summary. Adjustable.

### Primitive

New shared **`StatTile`** (`src/components/dashboard/stat-tile.tsx`): `{ label, value, meta?, href?, tone? }`,
on `.card-surface`/`.stat-card` tokens, `tabular-nums`, server-component-safe. Shared so the future
GC aggregate Dashboard reuses it unchanged.

### Data reads

Server component reads `titles` (org-scoped by RLS) with the release fields + status + created_at;
counts computed in the component (no aggregate RPCs yet). Revenue: none (placeholder).

---

## Testing / verification

- **DB:** `set_release_date` rejects non-GC callers; client has no `release_date` write path;
  `create_title` enforces the re-release rule; backfill maps `release_year` → both dates.
- **Unit (Vitest):** `effectiveReleaseDate` + bucket logic across edge cases (release_date null,
  future, boundary days; new vs re-release).
- **Manual:** new-release title (GC sets future `release_date` → Upcoming); re-release (client
  original + GC re-release date → Upcoming); confirm client cannot set `release_date`.
- `pnpm typecheck && pnpm lint && pnpm test` green before PR.

## Out of scope (seams)

Revenue numbers (statements module), per-platform/per-window release dates, GC aggregate Dashboard,
`/titles` release-filtered views.

## Sequencing

Slice A (migration → apply → app + spec + types) then Slice B (helper + tiles + tests). One PR.
