# Asset-upload slice — design (groundwork)

> Status: design pending approval. Third product-domain slice, on the org/RLS/provenance
> spine + `titles` (and alongside `rights_grants`). Source of truth for *what*:
> `docs/domain-spec.md` §12 (intake) + golden rule 14 + §21 (Glacier/purge). This doc is the
> *how* for the upload groundwork only.

## Context

Build order: `title stub → rights grant → asset upload`. Titles and rights grants shipped. This
slice adds **asset upload** — the client delivers platform-ready materials (§12; GC never
transcodes). The spec flags it as "likely the largest single build item in v1," so it is
**decomposed**; this slice is the upload groundwork only.

Golden rule 14: **presigned multipart upload direct to S3, never proxied through the app; S3 keys
in Postgres, never URLs; signed download URLs on demand from server code.** §12: ingest is source
data (`received_at`, `content_hash`, `provided_by`); 50–200 GB masters are normal; resumable;
checksum-verified.

This is the **first slice with external infra (S3) and new secrets (AWS creds).**

## Scope

**In (upload groundwork):**
- `asset_kind` enum (`master`, `caption`, `artwork`) + `assets` table (immutable) + RLS + triggers
- **Presigned multipart flow** via Next.js route handlers: initiate → sign parts → complete
- `create_asset` RPC (immutable row written only on `complete`; `operate`-gated)
- Client upload UI on `/titles/[id]` (part-chunked PUT direct to S3, per-part SHA-256, progress, per-part retry)
- `aws` CLI setup list (bucket + CORS + least-privilege IAM + incomplete-multipart lifecycle sweep)
- pgTAP (tenant isolation, capability matrix, immutability)

**Out (deferred seams):**
- **Download / CloudFront signing** — on-demand signed URLs (delivery/screening-side)
- **Glacier 90-day tiering + `restoring` state** — bucket policy + a state consumed by *delivery*
- **Purge cron** (§21 — abandoned-at-`in_review` sweep)
- **Cross-session resume** (persist uploadId + `ListParts`) — in-session per-part retry covers groundwork
- **Abort endpoint** — the lifecycle rule sweeps abandoned multiparts; explicit cancel is a later nicety
- **AWS OIDC/role auth** — groundwork uses least-privilege long-lived keys (see Security)

## Decisions (locked)

- **Storage = S3** (rule 14; keys in Postgres, never URLs). Not Vercel Blob — Glacier tiering + CloudFront depend on S3.
- **Presign/complete = Next.js route handlers** (`/api/assets/*`), matching the repo (all server logic is route handlers; zero Supabase edge functions). AWS creds are server-only.
- **Immutable `assets` row written only on `complete`.** S3 holds in-flight multipart state; the DB never sees a half-uploaded asset; abandoned multiparts are swept by the lifecycle rule. Nothing mutable to reconcile.
- **Integrity via S3 SHA-256 checksums.** `ChecksumAlgorithm=SHA256` on the multipart; the client sends per-part SHA-256; S3 rejects a corrupted part; the composite object checksum S3 returns is stored as `content_hash` (provenance).
- **Asset kinds:** `master`, `caption`, `artwork` (enum, extensible by migration).
- **No size cap, no file-type restriction** (platform-ready; multipart handles up to 5 TB).
- **Write is RPC + route handler split:** the route handler does S3 (server-only AWS SDK); the DB write goes through the `create_asset` SECURITY DEFINER RPC (capability re-checked). No client table writes.

## Data model

```sql
create type asset_kind as enum ('master','caption','artwork');

create table assets (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete restrict,
  title_id       uuid not null references titles(id)        on delete restrict,
  kind           asset_kind not null,
  storage_key    text not null,        -- S3 object key; NEVER a URL (rule 14)
  content_hash   text not null,        -- S3 composite SHA-256 checksum (provenance)
  bytes          bigint not null,
  content_type   text,                 -- client-declared MIME (advisory)
  original_filename text,
  received_at    timestamptz not null default now(),   -- ingest time (§12)
  provided_by    uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
-- indexes: (org_id), (title_id), (title_id, kind)
```

**Immutable** like `source_records` / `rights_grants`: no UPDATE/DELETE (revoked); the row **is**
the source record for the file (audit_log via `tg_audit` is the provenance trail — golden rule 5).
No separate `source_documents` row. `storage_key` is an S3 key only; download URLs are signed on
demand later (rule 14), never stored.

## Upload flow (presigned multipart, direct to S3)

Three route handlers (server-only AWS SDK + the user's Supabase session for authz):

1. **`POST /api/assets/initiate`** — `{ titleId, kind, filename, contentType, bytes }`. Verify
   session + `member_can(operate)` on the title's org + title∈org. Derive an S3 key
   `orgs/{org_id}/titles/{title_id}/{kind}/{uuid}/{filename}` (server-derived — never trust a
   client key). `CreateMultipartUpload(ChecksumAlgorithm=SHA256)`. Return `{ uploadId, key, partSize }`.
2. **`POST /api/assets/sign-parts`** — `{ key, uploadId, partNumbers[] }` → presigned `UploadPart`
   URLs (short expiry, e.g. 15 min). On-demand so failed parts can be re-signed and retried
   (in-session resumability).
3. **`POST /api/assets/complete`** — `{ titleId, kind, key, uploadId, parts:[{partNumber, etag,
   checksumSHA256}], bytes, filename, contentType }`. Re-verify capability + title∈org.
   `CompleteMultipartUpload`. Then call `create_asset` RPC with `content_hash` = the composite
   checksum, `storage_key`, `bytes`, `provided_by`. Return the asset.

**Client (on `/titles/[id]`):** pick kind + file → chunk into parts (~64 MiB, capped to ≤10 000
parts) → for each part compute SHA-256 (Web Crypto, per-chunk) and PUT to its presigned URL with
`x-amz-checksum-sha256` → track progress → retry a failed part (re-sign) → POST `complete`. Parts
go **direct to S3**, never through the app server (rule 14).

## RPC

`create_asset(p_org_id, p_title_id, p_kind, p_storage_key, p_content_hash, p_bytes, p_content_type,
p_filename) returns uuid` — SECURITY DEFINER, `set search_path = public`; raises unless
`member_can(auth.uid(), p_org_id, 'operate')` and the title belongs to the org; inserts one
immutable row; returns id. `revoke execute … from public, anon; grant … to authenticated`.

## RLS

- SELECT: `member_can(auth.uid(), org_id, 'view')`.
- INSERT: only via `create_asset`. UPDATE/DELETE: none + revoked (immutable). `revoke all … from anon`.

## Infra — `aws` CLI setup (founder-run)

A copy-paste list (built in the plan) creating, in the GC AWS account:
- **Bucket** in a chosen region, **Block Public Access = on** (all objects private; access only via
  signed operations).
- **CORS**: allow `PUT`/`GET` from the app origin(s); allow headers incl. `x-amz-checksum-sha256`,
  `content-type`; expose `ETag`.
- **Least-privilege IAM** (app server principal): `s3:PutObject`, `s3:GetObject`,
  `s3:ListMultipartUploadParts`, `s3:AbortMultipartUpload` on `arn:…:bucket/*` (Create/Upload/
  Complete-MultipartUpload are covered by `PutObject`). No `s3:DeleteObject` (nothing is deleted).
- **Lifecycle rule**: `AbortIncompleteMultipartUpload` after ~7 days (sweeps abandoned uploads).
  *(Glacier 90-day master tiering is a later slice — noted, not created here.)*
- **Env vars (server-only, never `NEXT_PUBLIC`):** `AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`. Added to `.env.example` (names only) and Vercel.

## Security (Tier 3 — first external-secret slice)

- AWS creds **server-only**; never in the client bundle. `leak-check` is load-bearing this slice.
- **Authz is the route handler, not the S3 key.** Every handler re-verifies session +
  `member_can(operate)` + title∈org; the client never supplies the S3 key or `org_id` to trust.
- Presigned URLs **short-lived** (≤15 min); scoped to one `PutObject` of one part.
- CORS locked to the app origin; bucket fully private (Block Public Access).
- Long-lived access keys are the groundwork tradeoff; **Vercel OIDC → AWS role** is the hardening
  follow-up (logged to `known-divergences.md` when the slice lands).

## Verification

- **pgTAP `assets_test.sql`:** tenant isolation (org A can't see org B's assets); `create_asset`
  capability matrix (owner/delivery_ops yes; viewer/legal/accountant raise; GC all-orgs);
  immutability (UPDATE/DELETE raise); asset belongs to a title in the same org (cross-title/org insert rejected).
- **Route-handler authz:** unauth / wrong-role / cross-org `initiate` + `complete` are rejected
  (integration test once a JS runner exists; else manual + the RPC-level pgTAP covers the DB gate).
- **Manual (after bucket exists):** upload a multi-part file on `/titles/[id]` → object present in
  S3, `assets` row with correct `content_hash`/`bytes`, appears in the list; reload persists.
- `typecheck` / `lint` / `build` green; **`leak-check`** (no AWS creds in the client bundle).

## Seams left clean

`storage_key` is ready for on-demand CloudFront signing (download slice). The `assets` row is the
delivery target (`title × vendor × territory` will reference it). Glacier tiering + `restoring`
state, the purge cron, cross-session resume, and OIDC auth are all named, unbuilt seams.
