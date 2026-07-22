# Dashboard charted hero — design

**Date:** 2026-07-22
**Status:** Approved (locked treatment) — founder sign-off 2026-07-22 ("lock it in")
**Branch:** `feat/dashboard-charted-hero`

## Goal

Give the client Dashboard a **single, confident hero**: one charcoal band carrying a data-viz of
catalog growth over time, plus the portfolio snapshot as a stats row. This is the settled hero
treatment for the Dashboard — the visual anchor the surrounding content sits under.

Supersedes the top of the `2026-07-21-release-dates-and-dashboard-tiles` layout: the 4-tile
`StatTile` grid (Catalog / Revenue / Upcoming / New releases) is replaced by the hero's stats row
(**Catalog · Upcoming · Live · Revenue**). The "Just in", attention-pointer, and org-status cards
below are unchanged. `StatTile` is retained (still used elsewhere / future GC aggregate).

## The treatment (locked)

- **One charcoal band** — `--band` (a sanctioned greyscale surface per `tokens.css`, "the dramatic
  dark band (portal / insights)"), rounded-lg, spanning the content column. Not full-bleed (content
  is capped at 1080px with a 48px inset; a rounded band reads as the hero and stays in the card system).
- **Headline** — eyebrow "Catalog activity", the current catalog total as the hero figure, and a
  delta line (`▲ +N <range word>`, accent-tinted arrow; neutral "No new titles …" when zero).
- **Range selector** — a pill segmented control: **30D · 90D · 1Y · All** (default 1Y). Client-side;
  changes the window without a round-trip.
- **The chart** — a single-series **area chart of cumulative catalog size over time**, hand-rolled
  SVG (no charting dependency — matches GC restraint). Accent line (2px) + accent→transparent
  gradient fill, recessive gridlines, a **playhead** (vertical hairline + ringed dot) on the latest
  point, and a **month axis** (labels adapt: day+month ≤ 90D, month otherwise). A **crosshair +
  tooltip** hover layer (date + cumulative titles) per the dataviz method.
- **Stats row** — Catalog · Upcoming · Live · Revenue on the band. Revenue is a seam ("—") until
  the statements module lands.
- Designed for the **dark surface** directly (the band is dark in both light and dark app themes);
  accent `#1769ff` validated ≥ 3:1 on the band. The chart is not a flipped light chart.

## Data & provenance (design call)

**The chart plots REAL data, not placeholder.** The series is derived deterministically from
`titles.created_at` (cumulative count of titles as of each point, running total including titles
that predate the window). Source: the org's `titles` rows, already RLS-scoped and loaded by the
Dashboard server component; no new query, no new table.

- This honours the brand hard-rule *"Never invent anything — no invented stats."* The earlier
  exploration used a placeholder curve; that is explicitly **not** shipped.
- Empty / sparse catalogs **degrade honestly**: with zero titles the band shows "Your catalog
  activity charts here as titles are added" instead of a faked line.
- `nowMs` is passed from the server so range windows agree across SSR/CSR (no client `Date.now()`
  in the render path → no hydration drift).

## Accessibility

- `role="img"` with a summarising `aria-label`; an `sr-only` table view of the series (dataviz:
  identity/values never colour-alone).
- A visually-hidden page `<h1>` ("Dashboard — {org}") since the visible hero has no H1.
- Reduced-motion honoured by the global rule in `globals.css`.

## Flexible / deferred (design the seam, don't over-build)

- **What it plots** is intentionally catalog *size* growth for now. If content strategy later wants
  "reach" (deliveries live over time) or titles-added-per-period, the component takes a different
  precomputed series — the treatment (band, selector, playhead, axis, tooltip, stats row) is fixed;
  the series is swappable.
- **Revenue** stat and any financial charting wait on the statements/revenue module.
