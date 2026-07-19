# Work identity + same-work conflict warning — design (slice B-work)

> Status: design pending approval. Builds on B-rights (exclusivity captured on `rights_grants`) and the
> `in_review` gate + `(gc)` surface. Source of truth for *what*: `docs/domain-spec.md` §9/§13 + the
> conflict-prevention model brainstormed 2026-07-19 (see [[2026-07-19-rights-exclusivity-design]]).
> This doc is the *how* for **work identity + the soft (GC-side) conflict warning + rights display at
> review** — the second of the delivery sub-slices. The hard block at delivery is B-del.

## Context

Two clients can bring the **same underlying work**. A **direct conflict** exists for (same work, same
`rights_type`, overlapping territory) **only when an exclusive claim is involved** — two non-exclusive
claims may overlap and both deliver. B-rights captured exclusivity at intake; this slice adds the
missing half needed to *detect* the conflict: **work identity** (knowing two `title` rows are the same
work) and a **soft warning to GC**. The **hard block** lives at delivery (B-del) and reuses this
slice's overlap helper + detection.

Why the link is load-bearing: **both** the soft warning (here) **and** B-del's hard block key off the
work link. If GC never links two same-work titles, neither fires — so the linking step is assisted, not
left to unaided memory (see Key decisions).

## Scope

**In:**
- `works` table (GC-administered) + nullable `titles.work_id` (GC-writable only).
- `link_title_to_work_of` RPC — SECURITY DEFINER, `is_gc_staff`-gated; direct writes to `works` /
  `titles.work_id` revoked.
- A cross-org **suggestion query** (normalized title + `release_year`, runtime/director tiebreakers) to
  prompt GC with likely same-work matches at review.
- `territories_overlap(mode_a, terr_a, mode_b, terr_b)` — pure SQL helper reconciling world/include/
  exclude set semantics. **Reused by B-del.**
- **Computed** same-work conflict detection surfaced (GC-only) at `/gc/review`.
- Rights + exclusivity **display** on `/gc/review` cards (verify-against-chain-of-title; carried from
  the B-rights review finding).
- pgTAP + app checks.

**Out (seams):**
- The **hard block at delivery** — B-del (imports `territories_overlap` + the detection predicate).
- The **persistent findings store** (§19) — the warning is computed on-read now; that detection becomes
  a finding *producer* when the store lands.
- **Client-facing** conflict messaging (must not reveal the other party) — later.
- **Canonical-ID (EIDR/IMDb) matching** — a future signal for the same suggestion engine.
- **Merging two pre-existing works** — edge case; the review flow links an incoming title to an
  existing catalog title.

## Key decisions

- **`works` table + `titles.work_id` (nullable).** A title may be unlinked (the common case). "Same
  work, different client" = two titles sharing `work_id` with different `org_id`. `works` also becomes
  the natural home for slice C's market-metadata override (`label` seeds that).
- **Manual link at review, system-assisted.** GC confirms every link (no false auto-links — "false
  flags kill the queue"), but the system **surfaces candidates** so a duplicate isn't missed. Matching
  is **title + `release_year`** (not name alone — same film has localized/alternate titles; different
  films share names), runtime/director as tiebreakers, cross-org (duplicates come from *different*
  clients; GC reads all orgs). Honest limit: no linking approach is an absolute guarantee; a genuinely
  dissimilar duplicate can still be missed. Canonical-ID matching is a future add to the same engine.
- **Warning is computed on-read, not stored, not dismissible.** The conflict is deterministic and
  derived, so computing it is always correct and **auto-clears** when grants/link change — no stale
  finding to reconcile, and *not a competing store* (nothing persisted → the "two stores disagree"
  failure can't occur). Not dismissible: a "dismiss" on a deterministic conflict hides a real problem.
  Seam: when the findings store lands, this same query becomes its producer.
- **Warning is GC-only.** It names another org's title/claim, so surfacing it on the client's
  title-detail page would leak cross-tenant data. It lives only on `(gc)` surfaces.
- **`territories_overlap` is the single source of overlap truth** for both this warning and B-del's
  hard block — one helper, not two implementations.

## Data model

```sql
create table works (
  id         uuid primary key default gen_random_uuid(),
  label      text,                              -- optional GC reference name; slice C market-metadata hangs here
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.titles add column if not exists work_id uuid references public.works(id);
create index if not exists titles_work_idx on public.titles (work_id);
```
- Triggers: `tg_audit` + `tg_set_updated_at` on `works`. `titles` already audits; the `work_id` change
  is captured by the existing `titles` audit trigger.
- **RLS on `works`:** `is_gc_staff` for SELECT/INSERT/UPDATE; no DELETE (golden rule 2). Clients never
  read `works` directly (a work spans orgs — GC-only). `revoke all from anon`.
- **`titles.work_id` is GC-write only** — the link goes through the SECURITY DEFINER RPC.
  **Implementation must verify** no client-writable path can set `work_id`: check the current `titles`
  UPDATE RLS policy; if a client UPDATE policy exists, add a guard so `work_id` can only change to/from
  the same value for non-GC callers (or route all `work_id` writes exclusively through the RPC and keep
  `titles` client-UPDATE narrowly column-scoped). A client self-assigning `work_id` could fabricate a
  cross-org link — treat this as a real check, not an assumption.

## Territory overlap

```sql
create function public.territories_overlap(
  p_mode_a public.territory_mode, p_terr_a text[],
  p_mode_b public.territory_mode, p_terr_b text[]
) returns boolean language sql immutable
```
Truth table (symmetric):
- `world` × anything → **true** (world covers all; overlaps any non-empty coverage).
- `include` × `include` → **true iff** `p_terr_a && p_terr_b` (array intersect).
- `include` × `exclude` → **true iff** the include list has a code **not** in the exclude list
  (`exists a in include: a <> all(exclude)`).
- `exclude` × `exclude` → **true** (two finite exclusion sets over the ISO universe always share
  covered territory).

## Linking — suggestions + RPC

- **Suggestion query** (server-side, GC session): for the title under review, find other orgs' titles
  with matching normalized title (case/punctuation-folded) and equal `release_year` (from
  `title_metadata`), ranked; return a small candidate list. No write; purely to prompt GC.
- **`link_title_to_work_of(p_title_id uuid, p_target_title_id uuid) returns uuid`** (the work id):
  SECURITY DEFINER, `set search_path = public`; `raise` unless `is_gc_staff(auth.uid())`; if the target
  has a `work_id`, assign it to `p_title_id`; else create a `works` row and assign **both**. Returns the
  work id. `revoke execute from public, anon; grant to authenticated`. Revoke direct
  `insert/update/delete` on `works` from `authenticated, service_role` (RPC-only write path).

## Detection + warning (computed, GC-only)

A read-time predicate: for `p_title_id` with a non-null `work_id`, a conflict exists if there is a grant
`g_other` on another title in the same work (any org) where
`g_other.rights_type = g_self.rights_type` AND `territories_overlap(...)` AND
`(g_self.exclusive OR g_other.exclusive)`, both grants active (`effective_to is null`). Computed by a
**plain query in the review data layer, run under the GC session** — GC's RLS `is_gc_staff` bypass
already grants cross-org read of `rights_grants`, and `territories_overlap` is called inline in the
query, so **no separate SECURITY DEFINER detection function is needed**. It returns the conflicting
counterpart rows (other org/title/right) for display as an `InlineNotice` on the `/gc/review` card.

## Surface — `/gc/review`

Extend each `in_review` card (existing `src/app/gc/review/page.tsx`) with:
- the title's **own grants** (rights_type · territory · Exclusive/Non-exclusive),
- a **suggestions** affordance (candidate same-work titles + a "link" action calling the RPC),
- the **conflict warning** (if the title is linked and a same-work exclusive overlap exists).
Greyscale affordances (D3). The approve/reject controls are unchanged.

## Verification

- **pgTAP:** `territories_overlap` full truth table (every mode pair, incl. world symmetry and the
  include/exclude asymmetric case); `link_title_to_work_of` (GC links; creates vs joins a work; client
  denied `42501`/`P0001`); the detection predicate (exclusive overlap flagged; two non-exclusive **not**
  flagged; different `rights_type` **not** flagged; non-overlapping territory **not** flagged;
  cross-org visibility under a GC session).
- `typecheck` / `lint` / `build` green; leak-check clean.
- Manual (GC account): two orgs with the same film; link them at review; an exclusive SVOD-US on both →
  warning shows on the review card naming the counterpart; make one non-exclusive → warning clears;
  confirm the client's own title page shows **no** cross-client warning.

## Seams left clean

`territories_overlap` + the detection predicate are the exact primitives B-del's `create_delivery`
imports for the hard block. `works.label` + the `works` row are where slice C's market-metadata
override attaches. The detection query is the first producer for the eventual findings store. The
suggestion engine takes a canonical-ID signal later without schema change to `works`.
