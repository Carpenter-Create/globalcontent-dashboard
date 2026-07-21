# Asset-access portal — Slice 2: screener room + engagement capture — design (slice Portal-2)

> Status: design pending approval. Second slice of the asset-access portal. Adds the **pitch-stage
> screener room**: an account-less prospect proves identity by OTP (reusing the Portal-1 gate) and
> *watches* a title's screener in an instrumented player streaming from S3 via CloudFront; GC sees who
> watched and how far. Builds on Portal-1 (`docs/superpowers/specs/2026-07-20-asset-portal-slice-1-
> master-download-design.md`, PR #13). Source of truth for *what*: `docs/domain-spec.md` §12 (assets)
> + golden rules 5/10/14. This doc is the *how* for Portal-2.

## Context

Portal-1 gave account-less **licensed endpoints** a gated master **download**. Portal-2 serves the
*earlier* moment: GC **pitches** a title to a prospective licensee by sending a branded screener-room
link. The prospect (no account) opens `/portal/<token>`, proves identity via the same OTP gate, and
**views** the screener in an instrumented player. Every playback event is captured so GC can see, per
viewer, how much was watched.

The pitch is **pre-license**, so — unlike the master download — the screener view carries **no
rights/grant/territory/delivery gate** (rule 12 governs *distribution*, not *pitching*). The only gate
is OTP identity. The screener streams **view-only** (best-effort; no DRM — leak-proofing is a separate,
deferred vendor decision). The whole Portal-1 gate is reused; Portal-2 adds a video source, a player,
an events pipeline, and a per-title screener-source choice.

## Scope

**In:**
- **`asset_kind` += `screener`** — an optional, client-uploaded pitch cut via the existing multipart
  path. **Screeners stay on S3 Standard (never Glaciered).**
- **`titles.screener_source`** enum `master | dedicated`, default `master`, client-editable at intake.
  The screener room's video source resolves from it: `dedicated` → the title's `screener` asset;
  `master` → the master. A **screenable gate** blocks link creation if `dedicated` but no completed
  screener asset exists (mirrors `submit_title`'s required-metadata gate) — the explicit choice can
  never silently disagree with reality.
- **Generalize `portal_links`** to host both link types so the OTP/session/access-event gate is shared:
  add `purpose` (`master_download | screener_view`), nullable `title_id`, nullable `delivery_id`/
  `asset_id`, a per-purpose CHECK, and backfill existing rows → `master_download`.
- **`screener_view_events`** (append-only) — the engagement capture: `session_id`, `link_id`,
  `event_type` (`play|pause|seek|progress|ended`), `position_seconds`, `runtime_seconds`, `occurred_at`.
- RPCs: **`create_screener_link`** (GC-only; screenable gate) · **`portal_resolve_screener`**
  (service-role; session + link validity → resolves source asset → returns storage_key) ·
  **`screener_engagement`** (derives per-viewer watched %, completed, replays, last-viewed on read).
- Routes: reuse `request-otp`/`verify-otp`; new **`/api/portal/screener`** (resolve + sign the stream
  URL) and **`/api/portal/screener-event`** (append a playback event). Both session-gated.
- **Public `/portal/[token]`** branches on link `purpose`: identity→code stages shared; final stage is
  the **screener room** (instrumented player + curated title info) instead of the download button.
- **Client intake**: `screener_source` selection + optional screener upload (reuses multipart + the
  new kind).
- **GC title view**: generate/copy/revoke a screener link + the **basic per-viewer summary**.
- pgTAP + Vitest + manual e2e.

**Out (seams — designed, not built):**
- **Rich scene-heatmap dashboard** — deferred to a post-launch follow-up. Granular events are captured
  now, so it is purely additive later (no backfill, no schema change).
- **ABR / transcoding** — progressive MP4 in v1; the instrumented-player-behind-URL-indirection seam
  keeps ABR a drop-in later (swap `<video>` for Shaka/dash.js).
- **DRM / forensic watermark** — view-only is best-effort; leak-proofing is a separate vendor/founder
  decision, not this app's transcode rule.
- **Glacier `restoring`** — dedicated screeners never Glaciered. If the source resolves to a *master*
  already in Glacier (title pitched >90 days after upload — rare), the player shows the same
  "preparing" state as the download; the real restore is Portal-3.

## Key decisions (from the design dialogue)

- **S3 + instrumented player, not YouTube.** Earns per-viewer engagement analytics and reuses the
  Portal-1 CloudFront signing; YouTube gives only aggregate view counts and throws away the seams.
- **Full OTP gate (reuse Portal-1).** Verified identity is the point of "who accessed the screener
  room" and of tying analytics to a real person; reuse beats a weaker new code path.
- **Screener source is a binary, explicitly stored** (`master | dedicated`) with a link-creation
  validation gate — founder chose explicit-with-gate over implicit resolution.
- **No rights gate on the pitch view** — founder-confirmed; rule 12 is about distribution.
- **Rich heatmap deferred to post-v1; basic per-viewer summary ships now.** Capture granular events in
  v1 regardless, so the dashboard is additive.
- **Analytics is Postgres + house charting, never AWS analytics infra** — Kinesis/Athena/QuickSight are
  overkill at GC's scale; AWS stays S3 (store) + CloudFront (sign) only.
- **Screener-link management lives on the GC *title* view**, not `/gc/deliveries` — pitching is
  per-title and pre-delivery.
- **Instrumented `<video>` for v1**, Shaka deferred to the ABR slice — behind the URL-indirection route
  so the swap is contained.

## Data model

```sql
-- asset_kind gains 'screener' (screeners stay on S3 Standard; no Glacier lifecycle)
alter type public.asset_kind add value if not exists 'screener';

-- per-title screener source (client-editable; default master)
do $$ begin create type public.screener_source as enum ('master','dedicated');
exception when duplicate_object then null; end $$;
alter table public.titles
  add column if not exists screener_source public.screener_source not null default 'master';

-- generalize portal_links to host both link purposes (shared OTP/session/events gate)
do $$ begin create type public.portal_link_purpose as enum ('master_download','screener_view');
exception when duplicate_object then null; end $$;
alter table public.portal_links
  add column if not exists purpose  public.portal_link_purpose not null default 'master_download',
  add column if not exists title_id uuid references public.titles(id) on delete restrict,
  alter column delivery_id drop not null,
  alter column asset_id    drop not null;
-- existing rows are already 'master_download' via the column default (backfill = no-op).
alter table public.portal_links add constraint portal_links_purpose_shape check (
  (purpose = 'master_download' and delivery_id is not null and asset_id is not null and title_id is null)
  or
  (purpose = 'screener_view'   and title_id is not null and delivery_id is null and asset_id is null)
);

-- engagement capture (append-only, rule 5)
do $$ begin create type public.screener_event as enum ('play','pause','seek','progress','ended');
exception when duplicate_object then null; end $$;
create table if not exists public.screener_view_events (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.portal_sessions(id) on delete restrict,
  link_id          uuid not null references public.portal_links(id)    on delete restrict,
  event_type       public.screener_event not null,
  position_seconds int  not null default 0,
  runtime_seconds  int,
  occurred_at      timestamptz not null default now()
);
create index if not exists screener_view_events_link_idx    on public.screener_view_events (link_id);
create index if not exists screener_view_events_session_idx on public.screener_view_events (session_id);
```

- **RLS (both new/changed tables):** GC-only SELECT (`is_gc_staff`); `revoke all from anon`; write
  revoked from `authenticated`. `screener_view_events` is written only by the service-role route (INSERT
  only) and has **UPDATE/DELETE revoked from everyone incl. service_role** (append-only, rule 5),
  matching `portal_access_events`.
- **`portal_links` least-privilege stays as Portal-1 set it** (RPC-only-write; service_role has no
  direct write). The new `create_screener_link` RPC is the sole screener-link write path.
- **The `alter type ... add value` for `asset_kind`** cannot run inside a transaction with later use of
  the new value in the same migration in some PG versions — keep the enum add in its own migration
  statement ordering per the repo's enum pattern; verify on apply.

## Enforcement — RPCs

**`create_screener_link(p_title_id uuid, p_token_hash text, p_expires_at timestamptz default null)
returns uuid`** — SECURITY DEFINER, `is_gc_staff` only.
1. `is_gc_staff` gate; else raise.
2. Title exists; read `screener_source`.
3. **Screenable gate:** if `screener_source = 'dedicated'`, a completed `screener` asset must exist for
   the title, else raise ("Set a dedicated screener source but no screener uploaded"). If `'master'`,
   a `master` asset must exist, else raise.
4. Validate `p_expires_at` future if provided (as Portal-1); insert `portal_links` with
   `purpose='screener_view'`, `title_id`, `token_hash`, default 14-day expiry. Return id.

**`portal_resolve_screener(p_session_token_hash text) returns table(storage_key text, link_id uuid,
session_id uuid, title_id uuid)`** — SECURITY DEFINER, service-role only.
- Validate session (unrevoked, unexpired) and its link (`purpose='screener_view'`, unrevoked,
  unexpired). No grant/territory/delivery check (pitch view).
- Resolve source: `dedicated` → newest completed `screener` asset for the title; `master` → the master
  asset. Raise if the resolved asset is missing. Return its `storage_key` + ids.

**`screener_engagement(p_link_id uuid) returns table(...)`** — SECURITY DEFINER, GC-only read. Per
`session_id`, all derived on read (rule 4) — nothing stored:
- viewer name/company/email — from `portal_sessions`.
- **watched %** — `round(100 * max(position_seconds)::numeric / nullif(max(runtime_seconds), 0))`.
- **completed** — `bool_or(event_type = 'ended')` OR watched % ≥ 95.
- **replays** — `greatest(count(*) filter (where event_type = 'ended') - 1, 0)` (times finished beyond
  the first).
- **last-viewed** — `max(occurred_at)`.

Reuse **`revoke_portal_link`** (already GC-only, id-scoped) for screener links unchanged.

## Routes (service-role, server-side)

- **Reused:** `request-otp` / `verify-otp` — purpose-agnostic (validate link by token hash, capture
  identity, issue/verify code, mint session + cookie, log `room_viewed`/`otp_sent`/`otp_verified`).
- **`/api/portal/screener`** — POST, session-cookie → `portal_resolve_screener` → `signAssetUrl` →
  `{ type:'progressive', url }` (the seam shape; Glacier/misconfig → 409 "preparing"). Streams inline
  (range requests), never an attachment.
- **`/api/portal/screener-event`** — POST `{ event_type, position_seconds, runtime_seconds }`,
  session-cookie → insert `screener_view_events`. Zod-validated; bounded numbers.

## Surfaces

- **`/portal/[token]`** — the page resolves the link and branches on `purpose`: `master_download` →
  the existing download flow; `screener_view` → the **screener room** (shared identity→code gate, then
  an instrumented `<video>` fed by `/api/portal/screener`, surrounded by curated title info — title,
  logline, runtime — from `title_metadata`; no invented copy). The player posts play/pause/seek/
  periodic-progress/ended to `/api/portal/screener-event`.
- **Client intake** (existing upload/metadata flow): a `screener_source` control (master vs dedicated)
  and, if dedicated, a screener upload (reuses the multipart path + `screener` kind). Informational
  line when `master`: "Your master will be used for screenings."
- **GC title view**: a "Screen this title" panel — generate/copy/revoke a screener link, and the
  **basic per-viewer summary** (`screener_engagement`): viewer, % watched, completed, replays,
  last-viewed. Copy stays in `lib/`; design tokens only.

## Verification

- **pgTAP:** `create_screener_link` — GC-only; screenable gate (dedicated w/o screener asset refuses;
  master path works); non-future expiry refused; inserts a `screener_view` link with the CHECK
  satisfied. `portal_resolve_screener` — valid session resolves the right source (dedicated vs master);
  expired/revoked session or link refuses; wrong-purpose link refuses. `screener_engagement` — watched
  %/completed/replays math on seeded events. RLS: client cannot read `screener_view_events`/screener
  links; `screener_view_events` UPDATE/DELETE revoked incl. service_role; `portal_links` CHECK rejects a
  malformed row. Existing Portal-1 pgTAP still green after the `portal_links` generalization.
- **Vitest:** any pure helpers (e.g., watched-% / event-shape logic if extracted); the screener-event
  route body validation.
- **Manual e2e (post-provisioning):** client sets `dedicated` + uploads a screener → GC generates a
  screener link → logged-out browser → identity → code → screener plays (streamed, not downloaded) →
  scrub/pause/finish → GC summary shows that viewer's % watched + completion; revoke kills the link;
  `master`-source title screens the master.

## Seams left clean

- **Rich heatmap** reads the same `screener_view_events` — additive, no backfill.
- **ABR** swaps the `<video>` for Shaka/dash.js behind `/api/portal/screener` (unchanged response
  shape) + adds transcoding — the URL-indirection + player-component seam is already here.
- **DRM / forensic watermark** — a later vendor integration on the same stream path.
- **Glacier `restoring`** — master-as-screener inherits Portal-3's restore flow via the shared 409
  "preparing" branch; dedicated screeners never hit it.
- The **generalized `portal_links` + shared gate** now hosts any future portal link purpose.

## Dependency & branching

Portal-2 builds on Portal-1's gate (PR #13, unmerged). This slice is authored on
`portal-2-screener-room` stacked on `portal-1-master-download`; if #13 changes in review, rebase. Do
not merge Portal-2 before Portal-1.
