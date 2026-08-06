# Catalog at scale — pagination, server-side search, and bounded reads — design

> Status: design pending approval. Written after the 2026-08-05 performance work (PRs #75–#83),
> which fixed six real latency causes and surfaced a larger problem underneath them. Source of
> truth for *what*: `docs/domain-spec.md` §11 (catalog) + golden rules 1 (RLS) and 4 (derived
> numbers). This doc is the *how*.

## Context

Every list query in the app is unbounded — **fourteen of them, zero with `.limit()` or
`.range()`** — while `supabase/config.toml` sets `max_rows = 1000`. With one film that is
invisible. The founder's floor is **20,000 titles, with their artwork and video**, and there is
already a waitlist. Everything here is sized against that number, not against today.

The result is not slowness. It is **silent incorrectness**:

| At scale | What happens |
|---|---|
| `titles` query | Returns exactly 1,000 rows. Title 1,001 does not exist as far as the UI knows. **No error.** |
| `deliveries` | `.in("title_id", [1000 ids])` — huge IN clause, and its own result truncates at 1,000 |
| `titleArtworkUrls` | Poster **and** banner for N titles = up to 2N rows, capped at 1,000 — **roughly half the artwork silently vanishes** |
| Render | N cards into the DOM |
| Search / sort | JavaScript, over the fully-materialised array |

**A rights holder with 1,200 films would be unable to see 200 of them, with nothing indicating
anything is missing.** For a distribution platform that is a correctness failure, not a
performance one — and the artwork case is the worst, because it surfaces months later as "some
of my posters aren't showing" with no obvious cause.

This is more valuable than the ~232ms of remaining navigation latency. That figure is a
**constant**; this degrades with every upload.

## Scope

**In:**
- Keyset (cursor) pagination on every list surface, client and GC.
- Search and sort pushed into Postgres.
- Per-page artwork and delivery-count resolution — never catalog-wide.
- Indexes to support the above, including trigram search.
- An explicit bound on every list read, and a loud failure when one is missing.

**Out (deliberately):**
- PPR / Cache Components. Separate concern, separate spec. Pagination comes first — there is no
  value in painting a page instantly if it shows an incomplete catalog.
- Changing `max_rows`. It stays at 1,000 as a **safety net**. The fix is bounded queries, not a
  higher ceiling; raising it would only move the cliff.

## Assets at 20,000 titles — the biggest number in this document

**20,000 is the floor, not the target.** Using the real measured master from 2026-08-05
(11.16 GB) and real artwork (2.5–3.2 MB per image, poster + banner):

| | Volume |
|---|---|
| Masters | **~220 TB** |
| Artwork | ~110 GB (40,000 images) |
| Screeners / captions | additional, not yet sized |

### Storage cost, and why the lifecycle rule is now urgent

`docs/infra/portal-go-live-checklist.md` item 1 — masters transitioning to Glacier at 90 days —
**is still not done. The prod bucket has no lifecycle configuration at all.** Yesterday that was
worth half a cent a month against 320 MB. At 220 TB:

| Storage class | Monthly | Annual |
|---|---|---|
| S3 Standard (today) | **~$5,060** | **~$60,700** |
| Glacier Flexible | ~$792 | ~$9,500 |
| Glacier Deep Archive | ~$218 | ~$2,600 |

**That is roughly $51,000/year, and it accrues from the first titles onward.** It has moved from
a tidy-up to the single highest-value item outstanding — and it must be fixed *before* volume
arrives, because transitioning 220 TB retroactively costs per-object transition fees on top.

It also **cannot be done the way the runbook says.** That instruction — scope the lifecycle rule
to the `master/` prefix — matches **zero objects**, because `assetKey()`
(`src/lib/assets.ts:42-50`) builds keys as `orgs/<org>/titles/<title>/<kind>/<uuid>/<file>`, so
`master` sits *mid-key* and S3 lifecycle filters are prefix-only. The rule would show green in
the console and archive nothing. The correct mechanism is **object tags**, which needs
`s3:PutObjectTagging` (the app role does not have it) and tagging at
`CreateMultipartUpload`. Same mechanism already chosen for archiving rejected titles — design
them together, once.

### Second-order asset effects

- **Signed-URL memo cache** (`lib/signed-url-cache.ts`) is bounded at 2,000 entries with
  clear-on-overflow. With 40,000 artwork objects that will thrash. Once pagination lands only a
  page's worth is signed at a time, so the bound is probably fine — **but verify against the
  real access pattern rather than assuming.**
- **Glacier restores** take 3–12h. At scale, "client asks for a master back" becomes routine
  rather than exceptional, so the `restoring` state stops being an edge case and becomes a
  normal part of the delivery UI.
- **Ingest throughput.** 20,000 × 11 GB is 220 TB through the browser→S3 path. Upload is now
  parallel (#75) but **resumable upload is still not built** — a dropped connection on an 11 GB
  file loses the whole thing. At this volume that stops being an annoyance and becomes a support
  queue.

### One thing outside this spec that the numbers force

`CLAUDE.md` states delivery is **manual** — GC staff hand-deliver to each vendor portal. At
20,000 titles across ~20 vendors that is on the order of **400,000 manual deliveries**. At five
minutes each it is ~33,000 person-hours. **The manual model does not survive this scale.**

That is a business decision, not a code one, and it is not this spec's to make — but nothing in
the pagination work changes it, and it should be on the table before the waitlist converts.

## The two scales, which are different problems

- **Client catalog** (`/titles`) is scoped to one org. A large rights holder might hold
  low thousands.
- **GC operator surfaces** (`/queue`, `/gc/deliveries`, `/gc/findings`) span **all orgs** — these
  are where 20,000 actually lands, and they are the more urgent of the two.

## Key decisions

**Keyset, not offset.** `OFFSET 19000` makes Postgres walk 19,000 rows it then discards; deep
pages get progressively slower. Keyset pages on `(sort_key, id)` and stays flat at any depth. It
also cannot skip or duplicate rows when a title is added mid-browse, which offset can. The cost
is no arbitrary page jumps — acceptable, since the catalog UI is a browse grid, not a ledger.
Cursor is opaque (base64 of the tuple) so the shape can change later.

**Search in Postgres via `pg_trgm`, not `ILIKE '%…%'`.** A leading wildcard cannot use a B-tree,
so today's client-side `filterTitles` is the only thing that works — and it requires every row in
memory. A GIN trigram index on `title` supports substring and fuzzy matching at 20k and also
handles the misspellings a human search box gets. Full-text (`tsvector`) is the alternative but
is worse for short proper nouns and partial words, which is what film titles are.

**Delivery counts aggregate in the database, for the page only.** Today every delivery for every
title is fetched and counted in JavaScript. At 20,000 titles × ~20 vendors that is ~400,000 rows
to produce two integers per card. Replaced with a grouped aggregate over the ~50 titles actually
on screen.

**Artwork resolves for the page only.** `titleArtworkUrls` already batches, but it is handed
*every* title id. Handing it only the visible page bounds it permanently.

**Counts are approximate above a threshold.** An exact `count(*)` over 20,000 RLS-filtered rows
on every page load is its own performance problem. Show an exact count below ~1,000 and
`"1,000+"` above it, or fetch the exact count lazily. **Never block the grid on a count.**

**Every list read must be explicitly bounded.** A missing bound is the bug this whole spec
exists to fix, so it should be impossible to reintroduce silently — see Verification.

## Data model / migration

No new tables. Indexes only, plus one extension:

```sql
create extension if not exists pg_trgm;

-- Keyset sort paths (org-scoped; the leading org_id matches the RLS predicate).
create index if not exists titles_org_created_id_idx on public.titles (org_id, created_at desc, id desc);
create index if not exists titles_org_title_id_idx   on public.titles (org_id, title, id);
create index if not exists titles_org_release_id_idx on public.titles (org_id, release_date desc nulls last, id desc);

-- Substring / fuzzy search on the title.
create index if not exists titles_title_trgm_idx on public.titles using gin (title gin_trgm_ops);

-- Per-title delivery aggregates for the visible page.
create index if not exists deliveries_title_status_idx on public.deliveries (title_id, status);
```

These are **destructive ops** under the repo rule (schema change). The exact SQL goes to the
founder for approval before it runs, and `create index concurrently` should be considered for
production so the tables are not locked.

**Check first:** `member_can()` is `SECURITY DEFINER` and is evaluated per row. At 20,000 rows
that is 20,000 function calls unless Postgres inlines it or the planner hoists it. Measure with
`EXPLAIN ANALYZE` against a seeded 20k dataset **before** assuming the indexes are sufficient. If
RLS dominates, that is its own follow-up and must not be papered over — golden rule 1 says RLS is
the authorization layer, so it gets optimised, never bypassed.

## Surfaces

- **`/titles`** — grid keeps its current look; gains "Load more" (or infinite scroll on
  intersection). Search and sort become server round-trips, debounced, reflected in the URL so a
  filtered view stays shareable and back/forward works.
- **`/queue`, `/gc/deliveries`, `/gc/findings`** — same treatment. Highest priority: these span
  every org.
- **Empty and end states** — "No titles yet" versus "No titles match that search" are different
  messages; the second needs a way back.

## Verification

- **Seed 20,000 titles** into local Supabase with realistic artwork rows. This is the point of
  the exercise; none of it can be validated against one film. Add the seed script to
  `scripts/` so the next person can reproduce it.
- `EXPLAIN ANALYZE` each list query at 20k — confirm index usage and that no plan degrades with
  page depth. Capture before/after numbers in the PR.
- **Correctness before speed:** assert that title 1,001 and its artwork are reachable. That is
  the actual bug.
- Paging through the full set yields every title exactly once, with no skips or duplicates when
  a row is inserted mid-page.
- A lint rule or test that fails when a `.from(...).select(...)` list read has no `.limit()` or
  `.range()` — this class of bug must not be reintroducible.
- `pnpm build`, `typecheck`, tests, `leak-check`.

## Phasing

0. **Close the S3 lifecycle gap** (tag-based, per the Assets section). Not pagination work, but
   it is ~$51k/year and it must land before volume, so it goes first.
1. **Bound every existing query** and surface a visible "showing first N" state. Small, ships
   immediately, converts silent truncation into something honest.
2. **Keyset pagination + server sort** on `/titles` and the GC surfaces.
3. **Trigram search**, replacing client-side `filterTitles`.
4. **Delivery-count aggregate** and page-scoped artwork.
5. **Re-measure**, then decide whether PPR is still worth doing.

Step 1 is worth doing on its own even if the rest waits — it turns a silent correctness bug into
a visible limitation, which is the difference between a client losing films and a client seeing
a note that says there are more.
