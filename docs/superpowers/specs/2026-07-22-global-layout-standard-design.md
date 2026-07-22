# Global layout standard — design

**Date:** 2026-07-22
**Status:** Approved (founder) — reference implementation shipped for Catalog + Dashboard
**Branch:** `feat/global-layout-standard`

## Goal

One modern layout language every surface obeys, so the whole product reads as one elite
system — not a set of separately-styled pages. We surpass the competitor (Filmhub) through
coherence + craft, **not** by copying their layout or their revenue-centric spine (revenue is
deferred; we never fake numbers).

**Register (founder-set):** *Adaptive, one grammar* — overview surfaces breathe; working surfaces
are dense tables; both from one set of primitives. **Modern + visual** — the catalog is a film
catalog, so poster artwork is first-class. **Quality bar = Coinbase / Mercury** ("financial
infrastructure"): the client's catalog is an **asset ledger** — precise, calm, trustworthy;
tabular figures, hairline precision, single-accent restraint, a real motion layer, designed
empty/loading states. Coherent with the marketing site (`globalcontent-web`): eyebrow → confident
headline, rounded panels, the playhead chart motif, accent status pills.

## Primitives — `src/components/layout/` (+ `ui/page-header.tsx`)

- **`PageHeader`** (extended) — optional `eyebrow` (accent kicker, the site's "THE PLATFORM"
  register) + title + subtitle + `backLink` + `actions`. THE header for every surface.
- **`PageStack` / `PageSection`** — page = a `PageStack` (gap-8) of `PageSection`s
  (`{ eyebrow?, title?, description?, actions? }`). Replaces ad-hoc `mt-3/6` + bare `<h2>`.
- **`Stat` / `StatGrid`** — the one KPI primitive; `surface: 'default' | 'band'`. Reconciles the
  old unused `StatTile` and the hero's inline `HeroStat` into a single component.
- **`DataTable<T>`** — declarative `columns: Column<T>[]` (`{ key, header, cell, align, sortable,
  gcOnly, width }`); one `<table>` renders every collection. **Server component** — sort is
  URL-driven (`?sort=&dir=`), the page sorts and passes `sort` + `sortHref`; no client JS. `gcOnly`
  columns render only for GC operators. Whole row is a stretched link when `rowHref` is given.
- **`PosterCard` / `Artwork`** — poster grid cell + poster image with a greyscale **monogram
  placeholder** when a title has no artwork. `Artwork` takes an already-signed URL; signing is
  server-side (`@/lib/artwork` → `@/lib/cloudfront`), best-effort (no CloudFront env / no artwork →
  placeholder). No transcode (GC never transcodes).
- **`ViewToggle`** — poster-grid ⇄ table switch; URL-driven (`?view=grid|table`), two links, no JS.
- **`StatusChip`** — restrained pill; greyscale by default, accent reserved for the `active/live`
  dot (echoes the site's filled-accent stepper node).
- **`EmptyState`** — designed empty block (icon + headline + line + action), not a bare card.
- **`Skeleton` / `PosterGridSkeleton` / `TableSkeleton`** — loading states (RSC + Suspense).

Pure, unit-tested helpers in **`src/lib/catalog-view.ts`**: `parseSort` / `parseView` (never trust
the URL), `sortRows` (stable, nulls-last), `nextSort` (header toggle), `buildQuery`.

## Rules (the standard)

- Every page opens with `<PageHeader>` and is a `PageStack` of `PageSection`s. No bespoke headers.
- Working-surface collections = `<DataTable>`. One concept, one rendering.
- Metrics = `<Stat>` / `<StatGrid>` only. Numbers are always tabular (`.t-data` / `tabular-nums`).
- One hover, one gap scale, `rounded-[var(--radius-*)]` only, one accent.
- **`catalog_id` is GC-only** — a `gcOnly: true` column; shown on GC surfaces, off the client's
  primary scan (titles list, dashboard). It's an internal cataloging/accounting reference; kept
  available (copyable, demoted) on the client title detail as a follow-up. See `docs/domain-spec.md`.
- Status/label vocabularies live in `lib/` (e.g. `DELIVERY_STATUS_ROW_LABELS`), never re-declared
  per page.

## Reference implementation (this PR)

- **Catalog `(app)/titles/page.tsx`** — poster grid (default) ⇄ dense table, `ViewToggle`,
  URL-driven sort, poster artwork with monogram fallback, `catalog_id` gcOnly (hidden client-side),
  `EmptyState`, add-title form in a `PageSection`.
- **Dashboard** — the hero's stats row now uses shared `Stat`/`StatGrid` (`surface='band'`);
  `catalog_id` removed from "Just in".
- **Deliveries** — local `STATUS_LABELS` deleted; uses `DELIVERY_STATUS_ROW_LABELS` from `lib`.

## Rollout (follow-up PRs, tracked here)

Migrate each surface onto the primitives, one PR per cluster:
1. **Title detail (client + GC)** — unify the two into `PageSection` + `DataTable`/rows; add the
   demoted copyable `catalog_id` reference; GC gets a `backLink`.
2. **Deliveries → `DataTable`** (client + GC), **Queue → `DataTable`**, **Vendors → `DataTable`**
   (delete the bespoke GC `h1+p` headers → `PageHeader`).
3. **Messages / Catalog Health / Agreements** — `PageSection` + `DataList` (card mode).
4. **GC titles list** reuses the catalog `DataTable` with `isGc` → `catalog_id` visible.

## Verification

- `tsc` · `eslint` · `vitest` (12 new tests on `catalog-view`; hero series tests still green).
- Playwright screenshots of the primitives (grid + client/GC tables + band/surface stats + empty +
  skeletons), light + dark, reviewed at the Mercury/Coinbase bar; `catalog_id` present GC / absent
  client confirmed.
- `leak-check` clean (poster URLs signed server-side).

## Blast radius / rollback

Presentational + one visibility change (`catalog_id` off client lists/dashboard). **No schema, no
RLS, no migration.** Rollback = revert the PR.
