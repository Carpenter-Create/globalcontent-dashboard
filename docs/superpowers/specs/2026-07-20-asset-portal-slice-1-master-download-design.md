# Asset-access portal — Slice 1: master download + the shared gate — design (slice Portal-1)

> Status: design pending approval. First slice of the asset-access portal. Builds the account-less,
> OTP-gated, CloudFront-signed **gate** and proves it on the simplest consumer — master download at
> delivery stage. Source of truth for *what*: `docs/domain-spec.md` §12 (assets) + §13 (delivery is
> manual, person-set) + golden rules 5/10/14. The screener room (Slice 2) and Glacier `restoring`
> (Slice 3) reuse this gate. This doc is the *how* for Portal-1.

## Context

GC delivers to distribution partners **by hand** (§13) — one path is sending the platform-ready
**master** to an endpoint. Today there is no way to hand a master to an account-less recipient:
`assets` is `member_can(view)`-only (an outside recipient has no `auth.uid()`), the schema stores an S3
**`storage_key` only** (rule 14), and the `assets` migration explicitly parked "download/CloudFront
signing" as a seam. This slice fills that seam.

A GC staffer generates a branded, single-purpose link tied to a **delivery's** master. The recipient
opens `/portal/<token>`, identifies themselves (name/company/email), proves the email via a code, and
downloads the master over a short-lived **CloudFront signed URL**. Every room view, code send, code
verification, and download is recorded — satisfying the recipient-side half of the audit requirement
("who accessed" + "who downloaded"; the GC-side "who exported metadata" is already `export_records`).

This is the *gate* — public route + opaque link + custom OTP + access session + append-only access
audit + edge-function signing behind a URL indirection. Slice 2 layers a JS player + engagement
analytics on the same gate; Slice 3 adds the Glacier `restoring` state for archived masters.

## Scope

**In:**
- Public route **`/portal/[token]`** — a sibling of `/login`, **outside the authenticated app shell**.
- **`portal_links`** — opaque single-purpose link, scoped to `(delivery_id, asset_id)`, token stored
  **hashed**; GC-only `create_portal_link` RPC returns the raw token exactly once.
- **`portal_otps`** — emailed code, stored **hashed**, ~10-min expiry, attempt-capped.
- **`portal_sessions`** — post-verification session (~24h), referenced by an opaque httpOnly cookie;
  a **row** (revocable/auditable), not a stateless JWT.
- **`portal_access_events`** — **append-only** recipient-side audit: `room_viewed | otp_sent |
  otp_verified | download`. Distinct from `audit_log` (which is trigger-populated for *authenticated
  org* actions; an account-less recipient has no `auth.uid()`).
- Three **edge functions** (service-role — the recipient has no JWT and `assets` RLS is closed):
  `portal-request-otp`, `portal-verify-otp`, `portal-download` (the **URL-indirection seam** that mints
  the CloudFront signed URL).
- **Grant re-verification at download time** (rule 12): the delivery's authorizing grant must still be
  active + in-window when the URL is signed — fails closed if it lapsed since link creation.
- GC surface to generate/copy/revoke a portal link from a delivery.
- pgTAP (RLS + RPC) + Deno edge-function tests + manual end-to-end.

**Out (seams — designed, not built):**
- **Glacier `restoring`** (Slice 3) — Portal-1 assumes the master is on S3 Standard (freshly
  delivered). If the object is not immediately retrievable, `portal-download` fails gracefully with a
  "preparing" message; the real restore flow (initiate restore, poll, notify) is Slice 3.
- **Screener player + engagement analytics** (Slice 2) — no `<video>`, no playback events here.
- **ABR / transcoding / DRM / watermarking** — deferred. The two seams (JS player, URL indirection)
  are established so ABR is a later additive change; Portal-1 needs neither.
- **Screener as an asset kind** — `assets.kind` gains `screener` in Slice 2, not here.

## Key decisions (from the design dialogue)

- **Link scoped to a delivery, not a bare title/asset.** A delivery (`title × vendor × territory ×
  grant`) already carries the endpoint identity and, via rule 12, the guarantee that it sits inside an
  active grant. The link inherits all of that, and the audit reads "who downloaded the master *for
  delivery X*" — matching the "assets we've sent" framing.
- **Full OTP gate at delivery stage.** Master download is the high-stakes asset, so identity is
  *verified* (emailed code), not merely self-asserted. (Slice 2 may use a lighter capture for
  pitch-stage screeners — decided there, not here.)
- **Re-verify the grant at download time.** Rule 12 requires "no delivery outside an active grant's
  scope and window — in the database." A grant can lapse between link creation and download, so
  `portal-download` re-checks the delivery's grant is active + in-window before signing. Fails closed.
- **A dedicated append-only `portal_access_events`, not `audit_log`.** `audit_log`'s trigger keys off
  authenticated, org-scoped writes; portal access is by an account-less external party with no
  `auth.uid()`. A separate append-only store (UPDATE/DELETE revoked at the permission level, mirroring
  rule 5) is the honest home for recipient-side provenance.
- **Session as a row + opaque cookie, not a stateless JWT.** A `portal_sessions` row is revocable and
  auditable (we can see and kill live sessions); the cookie is just an opaque handle. Rigor over
  statelessness for a Tier-3 access surface.
- **Bearer secrets are stored hashed.** The link token and the OTP code are treated like
  password-reset tokens: only their hashes are persisted; the raw values exist only in the URL / the
  email. `code_hash` is never selectable by any client.
- **All gate logic lives in edge functions, service-role (rules 10 + 14).** OTP issue/verify, session
  minting, grant re-check, and CloudFront signing are server-side. The S3 `storage_key` never leaves
  the server; only a short-lived signed URL does. Nothing here is trustable to the client.
- **Provision-in-parallel.** CloudFront distribution + GC subdomain + ACM cert + **CloudFront key
  pair** and **Resend** (account + verified sending domain) are founder/infra calls; the spec builds
  against them and real values are wired at implementation (as the S3 setup went).

## Data model

```sql
-- All four tables: RLS enabled; revoke all from anon; SELECT to authenticated only where is_gc_staff.
-- Write paths (no authenticated USER ever writes these directly — revoke insert/update/delete from
-- authenticated): portal_links via the GC-only SECURITY DEFINER create_portal_link/revoke_portal_link
-- RPCs (definer runs as owner, bypasses the revoke); portal_otps / portal_sessions /
-- portal_access_events by the service-role edge functions (service_role is the intended writer here —
-- these tables have no user write path, so unlike the repo's user-RPC tables we do NOT revoke from
-- service_role). portal_access_events additionally revokes UPDATE/DELETE from EVERYONE incl.
-- service_role (append-only, rule-5 style).

create table public.portal_links (
  id          uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.deliveries(id) on delete restrict,
  asset_id    uuid not null references public.assets(id)      on delete restrict,  -- must be kind='master'
  token_hash  text not null unique,          -- sha-256 of the opaque URL token; raw returned once
  created_by  uuid references auth.users(id),
  expires_at  timestamptz not null,          -- link validity window (GC-set, e.g. now()+14d)
  revoked_at  timestamptz,                   -- soft revoke; nothing is deleted (rule 2)
  created_at  timestamptz not null default now()
);
create index on public.portal_links (delivery_id);
create index on public.portal_links (asset_id);

create table public.portal_otps (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references public.portal_links(id) on delete restrict,
  email       text not null,
  code_hash   text not null,                 -- sha-256 of the 6-digit code; never selectable by clients
  expires_at  timestamptz not null,          -- ~ now()+10m
  attempts    int  not null default 0,       -- attempt cap (e.g. 5) enforced in verify fn
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.portal_otps (link_id);

create table public.portal_sessions (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references public.portal_links(id) on delete restrict,
  name        text not null,
  company     text not null,
  email       text not null,
  expires_at  timestamptz not null,          -- ~ now()+24h
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.portal_sessions (link_id);

do $$ begin
  create type public.portal_event as enum ('room_viewed','otp_sent','otp_verified','download');
exception when duplicate_object then null; end $$;

create table public.portal_access_events (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references public.portal_links(id) on delete restrict,
  session_id  uuid references public.portal_sessions(id),      -- null for room_viewed / otp_sent
  event_type  public.portal_event not null,
  email       text,                          -- captured identity at the time of the event
  name        text,
  company     text,
  ip          inet,
  user_agent  text,
  occurred_at timestamptz not null default now()
);
create index on public.portal_access_events (link_id);
create index on public.portal_access_events (occurred_at desc);
```

- **RLS (all four):** `revoke all from anon;` SELECT policy `using (public.is_gc_staff(auth.uid()))`;
  `revoke insert, update, delete from authenticated;` (no authenticated user writes these directly).
  `portal_links` is written by the GC-only definer RPCs; `portal_otps` / `portal_sessions` /
  `portal_access_events` are written by the **service-role edge functions** (service_role is *not*
  revoked for these — it is the intended writer, since there is no user write path; this is the one
  deliberate departure from the repo's "revoke from service_role too" pattern, which applies to tables
  with authenticated-user RPC write paths). `portal_otps.code_hash` / `portal_links.token_hash` are
  never reachable by a client SELECT (the GC-only policy ensures this; no client-facing view exposes
  the hashes; the account-less recipient reads nothing directly — the edge functions read via
  service_role).
- **Append-only:** `portal_access_events` additionally has UPDATE/DELETE revoked from **everyone incl.
  service_role** (rule 5 style) — it is the recipient-side provenance record; edge functions INSERT
  only.
- **`asset_id` must be `kind='master'`** — enforced in `create_portal_link` (Slice 2 relaxes to
  `screener`).

## Enforcement — RPC + edge functions

**`create_portal_link(p_delivery_id uuid, p_asset_id uuid, p_expires_at timestamptz default null)
returns text`** — SECURITY DEFINER, `is_gc_staff` only.
1. `is_gc_staff` gate; else raise.
2. Confirm the asset belongs to the delivery's title and is `kind='master'`; else raise.
3. Generate an opaque token (server-side random), store its **hash**, default `expires_at` to
   `now()+14d` if null, insert the `portal_links` row, and **return the raw token once** (the caller
   builds `/portal/<token>`; the raw token is never stored). (Per the repo gotcha, the optional param
   is declared `default null` so generated TS types accept omission.)

Also a small GC-only **`revoke_portal_link(p_link_id)`** RPC (sets `revoked_at`; nothing deleted).

**Edge function `portal-request-otp`** (service-role): resolve link by token hash → reject if
missing / expired / revoked. Capture `name/company/email`. Log `room_viewed` (first hit) → create an
OTP (hashed code, 10-min expiry) → send the code via **Resend** → log `otp_sent`. Rate-limit issuance
per link.

**Edge function `portal-verify-otp`** (service-role): given token + email + code → find the newest
unconsumed, unexpired OTP for the link/email, increment `attempts`, compare hashes (reject over the
attempt cap). On success: mark `consumed_at`, create a `portal_sessions` row (24h), set an opaque
httpOnly session cookie, log `otp_verified`.

**Edge function `portal-download`** (service-role, the **URL-indirection seam**): validate the session
cookie (exists, unexpired, unrevoked) → **re-verify** the delivery's grant is active + in-window (rule
12) → resolve the asset `storage_key` → if the S3 object is not immediately retrievable (Glacier),
return a graceful "preparing" response (Slice-3 seam) → else mint a **short-lived CloudFront signed
URL** (TTL on the order of minutes — long enough to start a multi-GB download, short enough that a
leaked URL dies fast) → log `download` → return `{ url }`. The response shape is deliberately `{ type: 'progressive',
url }` so Slice 2's player calls the same indirection and a future ABR variant returns `{ type:
'hls', manifest, cookies }` with no caller change.

## Surfaces

- **`/portal/[token]`** (public, unauthenticated, branded — design tokens only, neutral accent):
  identity-capture form → code entry → a download screen with the master's filename/size and a
  "Download" button that calls `portal-download` and follows the returned signed URL. Clear,
  transparent error states (link expired/revoked, code expired, too many attempts, file preparing).
  Voice: calm, declarative, no filler.
- **GC delivery detail / `/gc/deliveries`**: a "Send master" action that picks the delivery's master
  asset, calls `create_portal_link`, and shows the generated `/portal/<token>` URL to copy into the
  GC user's email, plus a list of that delivery's links with status (active/expired/revoked), a revoke
  control, and the access-event log (who viewed / downloaded, when). GC-only.

## Verification

- **pgTAP:** RLS on all four tables (anon denied; a client `authenticated` denied SELECT; GC read-only;
  INSERT/UPDATE/DELETE revoked for authenticated + service_role; `portal_access_events` UPDATE/DELETE
  revoked for all). `create_portal_link` — GC-only; rejects a non-master asset; rejects an asset not on
  the delivery's title; returns a token and inserts exactly one row. `revoke_portal_link` GC-only.
- **Deno edge-function tests:** bad/expired/revoked token rejected; OTP expiry + attempt cap enforced;
  `code_hash` never returned; a valid session required for download; **grant re-check** rejects a
  lapsed/out-of-window grant; each of the four `portal_access_events` types is written at the right
  step; the download response is `{ type:'progressive', url }`.
- **Manual (local):** GC generates a link → open `/portal/<token>` in a logged-out browser → email
  arrives (Resend test domain) → verify → download → confirm all four event types land in
  `portal_access_events` and are visible on the GC surface. **CloudFront signing** is the one piece
  needing the real key pair: stub-verify URL construction locally, do the live signed-download test
  once the distribution + key pair are provisioned.
- `typecheck` / `lint` / `build` green; regenerate TS types after the migration; `leak-check` (no
  CloudFront private key, Resend key, or service-role key in any client bundle).

## Seams left clean

- **URL indirection + JS-player-ready response** (`portal-download` returns a typed source) → Slice 2's
  screener player and a future ABR variant plug in with no caller change.
- **The whole gate** (route + `portal_links` + OTP + `portal_sessions` + `portal_access_events`) is
  consumer-agnostic → Slice 2 reuses it for the screener room (adding a `screener` asset kind + a
  playback-events store; the lighter pitch-stage capture is decided there).
- **Glacier `restoring`** → `portal-download` already has the "not immediately retrievable" branch;
  Slice 3 fills in initiate-restore + poll + notify. A delivery/link simply waits until the file is
  ready.
- **GC-side export audit (`export_records`)** already covers "who exported metadata" — Portal-1 adds
  the recipient-side half; together they are the full delivery-provenance picture.
```
