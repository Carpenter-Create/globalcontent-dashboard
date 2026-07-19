# in_review chain-of-title gate — design

> Status: design pending approval. Fifth product-domain slice, on the org/RLS/provenance spine +
> `titles`. Source of truth for *what*: `docs/domain-spec.md` §11 (titles/in_review) + §4/§22 (roles,
> GC scope-inversion). This doc is the *how* for the narrow gate + the first GC-side surface.
>
> **Branch note:** written off `main`; rebase onto `main` after PR #5 (asset-upload fix) merges before
> implementing. This slice edits `/titles/[id]/page.tsx` (touched by earlier slices), so rebase keeps
> it current. Migration number must sort after the latest on merged `main`.

## Context

Build order: `… → metadata intake ✓ → in_review chain-of-title gate (narrow) → vendor records → delivery`.
§11: with the account gate gone (clickwrap), **`in_review` is the one place a human intervenes, and it
checks exactly one thing — chain of title** (does this person own/control the film). Metadata
completeness, technical QC, and rights sanity are automated elsewhere and **must not be re-checked
here**. Scope it to minutes.

This is the **first GC-side (`gc_staff`) workflow** — every prior slice was client-facing. It stands up
the first GC-only surface and the first `is_gc_staff`-gated write.

## Scope

**In:**
- Title status transitions via RPCs: `submit_title` (client), `review_title` (GC)
- `review_decision` enum (`approve|reject`) + `title_reviews` table (append-only decision record)
- Client UI on `/titles/[id]`: "Submit for review" (draft only), status display, latest rejection reason
- **First GC surface:** a `(gc)` route group + layout (gated by `is_gc_staff`), and `/gc/review` —
  the cross-org queue of `in_review` titles with approve/reject + reason
- pgTAP; `gc_staff` provisioned for testing via a founder-run SQL insert (seam)

**Out (deferred seams):**
- **Chain-of-title *evidence* capture** — the reviewer decides from out-of-band info in v1; no
  evidence-doc upload/model yet
- **Notifications** (email/in-app on decision) — a later build-order slice
- `submitted` as a distinct "awaiting vs claimed" step — reserved in the enum, unused in v1
- Takedown transitions (`takedown_requested`/`taken_down`) + early-takedown fee — later
- Asset-purge cron for titles abandoned at `in_review` (§21) — later
- A full GC dashboard/nav/home + GC root-routing polish — only `/gc/review` here
- Delivery-readiness enforcement (metadata/assets/grant) — enforced at the *delivery* gate, not here

## State model

```
draft --submit_title--> in_review --review_title(approve)--> in_delivery
                          |
                          +--------review_title(reject)-----> draft   (+ rejection reason)
```
- The queue **is** the `in_review` state. `submitted` stays a valid enum value but is unused in v1.
- **Narrow by construction:** the RPCs check *status + capability only* — no metadata/QC/rights
  re-check (§11). Delivery-readiness is a later gate on `in_delivery → live`.
- **Submit prerequisites: minimal** — only that the title is in `draft` and the caller is
  operate-capable. Chain-of-title is about ownership, checkable before assets/metadata are perfect;
  gating submission on completeness would duplicate the delivery gate.

## Data model

```sql
create type review_decision as enum ('approve','reject');

create table title_reviews (
  id          uuid primary key default gen_random_uuid(),
  title_id    uuid not null references titles(id)        on delete restrict,
  org_id      uuid not null references organizations(id) on delete restrict,  -- denormalized for RLS
  reviewer    uuid references auth.users(id) on delete set null,              -- the gc_staff actor
  decision    review_decision not null,
  reason      text,                                                            -- required on reject
  created_at  timestamptz not null default now()
);
-- indexes: (title_id), (org_id)
```
Append-only / immutable (like `assets`, `contract_assents`): no UPDATE/DELETE (revoked); it survives
resubmit cycles and *is* the provenance for each decision (with `audit_log`). The client reads the
**latest** review to show a rejection reason after a bounce to `draft`.

## RPCs (SECURITY DEFINER, `search_path=public`; the only writers of `titles.status`)

- `submit_title(p_org_id uuid, p_title_id uuid) returns void` — `member_can(operate)` + title∈org +
  status must be `draft`; sets `in_review`. (No `title_reviews` row — submission isn't a decision;
  `audit_log` captures it.)
- `review_title(p_title_id uuid, p_decision review_decision, p_reason text) returns void` —
  **`is_gc_staff(auth.uid())`-gated** (first GC-only write; GC scope spans all orgs, §22); title must
  be `in_review`; requires `p_reason` when `p_decision='reject'`; sets `in_delivery` (approve) or
  `draft` (reject); inserts a `title_reviews` row (`org_id` derived from the title, never the client).

`titles` gets no client/GC direct UPDATE policy — status changes flow only through these definer RPCs.

## RLS

- `title_reviews` SELECT: `member_can(auth.uid(), org_id, 'view')` **or** `is_gc_staff(auth.uid())`
  (client sees its own title's reviews; GC sees all). INSERT/UPDATE/DELETE: none for clients; UPDATE/
  DELETE revoked (immutable); write only via `review_title`. `revoke all … from anon`.
- `titles`: existing SELECT policy already lets GC staff read all orgs (via `member_can`'s
  `is_gc_staff` bypass), so `/gc/review` can list cross-org `in_review` titles with no new read policy.

## Surfaces

- **Client — `/titles/[id]`:** a "Submit for review" button when `status='draft'` (operate roles),
  the status label, and — when a prior review rejected it — a greyscale notice with the reason.
  `submit` via a server action → `submit_title` RPC.
- **GC — `(gc)` route group:**
  - `(gc)/layout.tsx`: resolves the session, checks `is_gc_staff` (query `gc_staff` — RLS returns the
    caller's own row), redirects non-GC users away (to `/`). This is the first GC-only gate.
  - `(gc)/review/page.tsx` = `/gc/review`: lists all `in_review` titles (org name + title + submitted-at),
    each with approve / reject (reason) controls → `review_title` RPC via a server action.
  - > Rough edge (noted, not fixed): a GC user hitting `/` still meets the client `(app)` layout,
    > which redirects non-members. v1 GC users navigate straight to `/gc/review`; GC root-routing/home
    > is a later concern.

## gc_staff provisioning (seam)

`gc_staff` is provisioned out-of-band (§22). For testing/demo, a founder-run SQL insert adds a chosen
account: `insert into gc_staff (user_id, role) values ('<auth.uid>','gc_delivery_ops');` — shown for
approval, founder-run (destructive-ops). No self-service GC admin in this slice.

## Verification

- **pgTAP `in_review_test.sql`:** `submit_title` — operate can (draft→in_review), viewer/legal raise,
  wrong-status (not draft) raises, cross-org raises. `review_title` — **`is_gc_staff` only** (a client
  `account_owner` is rejected; a gc_staff succeeds across orgs), approve→in_delivery, reject→draft,
  reject requires a reason, wrong-status raises. `title_reviews` — immutability (UPDATE/DELETE raise),
  tenant isolation (org A can't read org B's reviews), GC reads all. `audit_log` gets the status change.
- `typecheck` / `lint` / `build` green; `leak-check` (no new secrets); manual: as a client, submit a
  draft title → as a `gc_staff` account (SQL-provisioned), open `/gc/review`, reject with a reason →
  title returns to `draft` with the reason shown; resubmit → approve → `in_delivery`.

## Seams left clean

`title_reviews` is the decision record notifications will read. The `(gc)` route group + `is_gc_staff`
layout gate is the foundation every later GC surface (delivery ops, view-as-client) builds on. The
delivery gate picks up at `in_delivery`.
