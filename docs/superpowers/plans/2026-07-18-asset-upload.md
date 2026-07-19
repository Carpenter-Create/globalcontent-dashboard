# Asset-upload (groundwork) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let clients upload platform-ready title assets via presigned multipart direct-to-S3, recorded as immutable rows.

**Architecture:** Next.js route handlers (`/api/assets/*`) hold server-only AWS creds and orchestrate S3 multipart (initiate → sign parts → complete); the browser PUTs parts directly to presigned URLs (never through the app); the immutable `assets` row is written only on `complete` via the `create_asset` RPC. Integrity via S3 SHA-256 per-part checksums.

**Tech Stack:** Next.js App Router (route handlers + server components), `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `zod`, Supabase Postgres (RLS, SECURITY DEFINER RPC, pgTAP), Web Crypto (client per-part hashing), TypeScript strict, Tailwind + GC tokens.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-18-asset-upload-design.md`. Domain source of truth: `docs/domain-spec.md` §12 + golden rule 14 + §21.
- **Golden rule 14:** presigned multipart **direct to S3, never proxied**; **S3 keys in Postgres, never URLs**; signed download URLs on demand (download slice, not here).
- **RLS is the authorization boundary** — SELECT via `member_can(..., 'view')`; the write goes only through the `create_asset` SECURITY DEFINER RPC (re-checks `member_can(..., 'operate')` + title∈org); no client table writes.
- **Immutable** — `assets` has no UPDATE/DELETE (revoked); row written once, on `complete`. `audit_log` via `tg_audit` is the provenance record.
- **Authz is the route handler, not the S3 key** — every handler re-verifies session + operate-capability + title∈org; the client never supplies a trusted key/org_id.
- **Secrets server-only** — `AWS_*` never `NEXT_PUBLIC`; never in the client bundle. `leak-check` is load-bearing this slice.
- **Asset kinds:** `master`, `caption`, `artwork` (enum, extensible). **No size cap, no type restriction.**
- **Money/Glacier/download are seams** — no CloudFront signing, no Glacier `restoring`, no purge cron, no cross-session resume, no OIDC in this slice.
- **Conventions:** UUID PKs, `timestamptz`, `snake_case`, TS strict, zod at the edge; regenerate `database.types.ts` after the migration (strip leaked CLI stdout lines — Task 1); design tokens + greyscale errors only.
- **Migration filename:** `supabase/migrations/20260718000500_assets.sql`.
- **Destructive-ops rule** — the migration creates a trigger + revokes UPDATE/DELETE; show exact SQL and get approval; the founder runs `supabase migration up` and `supabase gen types` (guard hook blocks the assistant).
- **Package manager:** `pnpm` (lockfile present; `pnpm add …` is permitted).

---

### Task 1: Migration — `asset_kind` enum, `assets` table, RLS, `create_asset` RPC

**Files:**
- Create: `supabase/migrations/20260718000500_assets.sql`
- Modify (founder-run regen): `src/lib/supabase/database.types.ts`

**Interfaces:**
- Consumes: `organizations`, `titles`, `member_can`, `is_gc_staff`, `tg_audit` (prior migrations).
- Produces: enum `public.asset_kind` (`master|caption|artwork`); table `public.assets`; `public.create_asset(p_org_id uuid, p_title_id uuid, p_kind public.asset_kind, p_storage_key text, p_content_hash text, p_bytes bigint, p_content_type text, p_original_filename text) returns uuid`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================================
-- 20260718000500_assets.sql
--
-- INTENT: Asset upload (domain-spec §12, golden rule 14) — the immutable record
-- of a platform-ready file uploaded to S3. The row is the source record for the
-- file (received_at/content_hash/provided_by inline); audit_log is its provenance
-- (golden rule 5). S3 KEY only, NEVER a URL (rule 14). Written once, on multipart
-- complete, via create_asset — no half-uploaded rows (S3 holds in-flight state).
--
-- DELIBERATELY EXCLUDED (seams): download/CloudFront signing, Glacier tiering +
-- restoring state, purge cron. No status column yet — an uploaded asset is simply
-- stored; lifecycle states arrive with the delivery/Glacier slices.
--
-- DESTRUCTIVE OPS (approved before apply): audit trigger on assets;
-- REVOKE UPDATE, DELETE on assets (immutability). Forward-only + idempotent.
-- ============================================================================

do $$ begin
  create type public.asset_kind as enum ('master','caption','artwork');
exception when duplicate_object then null; end $$;

create table if not exists public.assets (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete restrict,
  title_id          uuid not null references public.titles(id)        on delete restrict,
  kind              public.asset_kind not null,
  storage_key       text not null,     -- S3 object key; NEVER a URL (rule 14)
  content_hash      text not null,     -- S3 composite SHA-256 checksum (provenance)
  bytes             bigint not null check (bytes >= 0),
  content_type      text,              -- client-declared MIME (advisory)
  original_filename text,
  received_at       timestamptz not null default now(),
  provided_by       uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists assets_org_idx        on public.assets (org_id);
create index if not exists assets_title_idx       on public.assets (title_id);
create index if not exists assets_title_kind_idx  on public.assets (title_id, kind);

-- Provenance: reuse the generic audit trigger (assets has org_id). No updated_at
-- trigger — the row is immutable.
drop trigger if exists audit_assets on public.assets;
create trigger audit_assets after insert or update or delete on public.assets
  for each row execute function public.tg_audit();

alter table public.assets enable row level security;
revoke all on public.assets from anon;

drop policy if exists assets_select on public.assets;
create policy assets_select on public.assets for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));
-- INSERT: only via create_asset(). UPDATE/DELETE: none + revoked below (immutable).

revoke update, delete on public.assets from authenticated, service_role;

-- Write path: create_asset. Called by /api/assets/complete AFTER S3
-- CompleteMultipartUpload. Capability re-checked; title must belong to the org.
create or replace function public.create_asset(
  p_org_id           uuid,
  p_title_id         uuid,
  p_kind             public.asset_kind,
  p_storage_key      text,
  p_content_hash     text,
  p_bytes            bigint,
  p_content_type     text,
  p_original_filename text
) returns uuid
  language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized to add assets for this organization';
  end if;
  if not exists (select 1 from public.titles t where t.id = p_title_id and t.org_id = p_org_id) then
    raise exception 'Title does not belong to this organization';
  end if;
  if coalesce(btrim(p_storage_key), '') = '' or coalesce(btrim(p_content_hash), '') = '' then
    raise exception 'storage_key and content_hash are required';
  end if;

  insert into public.assets
    (org_id, title_id, kind, storage_key, content_hash, bytes, content_type, original_filename, provided_by)
  values
    (p_org_id, p_title_id, p_kind, btrim(p_storage_key), btrim(p_content_hash),
     coalesce(p_bytes, 0), p_content_type, p_original_filename, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.create_asset(uuid, uuid, public.asset_kind, text, text, bigint, text, text) from public, anon;
grant  execute on function public.create_asset(uuid, uuid, public.asset_kind, text, text, bigint, text, text) to authenticated;
```

- [ ] **Step 2: Show destructive SQL for approval; founder applies + regenerates types**

Present the `create trigger audit_assets` and `revoke update, delete on public.assets` statements. On approval the founder runs (guard hook blocks the assistant):
```
! supabase migration up
! supabase gen types typescript --local > src/lib/supabase/database.types.ts
```
Then the assistant strips any leaked CLI lines from `database.types.ts` (leading `Connecting to db …`, trailing update notice) — verify it starts with `export type Json =` and ends with `} as const`, and that `assets` / `create_asset` / `asset_kind` are present.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260718000500_assets.sql src/lib/supabase/database.types.ts
git commit -m "feat(db): assets — asset_kind enum, immutable assets table, RLS, create_asset RPC"
```

---

### Task 2: pgTAP — isolation, capability, immutability, cross-org

**Files:**
- Create: `supabase/tests/assets_test.sql`

**Interfaces:**
- Consumes: `assets`, `create_asset` (Task 1).

- [ ] **Step 1: Write the test** (mirrors `rights_grants_test.sql` idioms)

```sql
-- assets_test.sql
-- Assets: tenant isolation, create_asset capability matrix, immutability,
-- and cross-org title rejection.

begin;
select plan(9);

select set_config('t.org_a',  gen_random_uuid()::text, false);
select set_config('t.org_b',  gen_random_uuid()::text, false);
select set_config('t.owner',  gen_random_uuid()::text, false);  -- account_owner, A
select set_config('t.deliv',  gen_random_uuid()::text, false);  -- delivery_ops,  A
select set_config('t.viewer', gen_random_uuid()::text, false);  -- viewer,        A
select set_config('t.gc',     gen_random_uuid()::text, false);  -- GC staff
select set_config('t.title_a',gen_random_uuid()::text, false);
select set_config('t.title_b',gen_random_uuid()::text, false);

insert into auth.users (id) values
  (current_setting('t.owner')::uuid), (current_setting('t.deliv')::uuid),
  (current_setting('t.viewer')::uuid), (current_setting('t.gc')::uuid);
insert into public.organizations (id, name) values
  (current_setting('t.org_a')::uuid, 'Org A'), (current_setting('t.org_b')::uuid, 'Org B');
insert into public.memberships (org_id, user_id, role, status) values
  (current_setting('t.org_a')::uuid, current_setting('t.owner')::uuid,  'account_owner', 'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.deliv')::uuid,  'delivery_ops',  'active'),
  (current_setting('t.org_a')::uuid, current_setting('t.viewer')::uuid, 'viewer',        'active');
insert into public.gc_staff (user_id, role) values
  (current_setting('t.gc')::uuid, 'gc_delivery_ops');
insert into public.titles (id, org_id, title) values
  (current_setting('t.title_a')::uuid, current_setting('t.org_a')::uuid, 'Title A'),
  (current_setting('t.title_b')::uuid, current_setting('t.org_b')::uuid, 'Title B');

-- Fixture asset (owner-role setup).
insert into public.assets (org_id, title_id, kind, storage_key, content_hash, bytes)
values (current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
        'master', 'orgs/a/titles/a/master/x/file.mxf', 'sha256:abc', 123);

-- ===== authenticated =====
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.owner'), 'role', 'authenticated')::text, true);

select isnt_empty($$ select 1 from public.assets where org_id = current_setting('t.org_a')::uuid $$,
  'owner_a sees own org assets');
select is((select count(*) from public.assets where org_id = current_setting('t.org_b')::uuid)::int,
  0, 'owner_a CANNOT see org B assets (tenant isolation)');

select throws_ok($$ update public.assets set content_hash = 'tamper' $$,
  '42501', null, 'assets UPDATE blocked (immutable)');
select throws_ok($$ delete from public.assets $$,
  '42501', null, 'assets DELETE blocked (immutable)');

select lives_ok($$ select public.create_asset(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  'caption', 'orgs/a/titles/a/caption/y/subs.vtt', 'sha256:def', 10, 'text/vtt', 'subs.vtt') $$,
  'account_owner: create_asset succeeds');

-- cross-org: title B does not belong to org A → raises
select throws_ok($$ select public.create_asset(
  current_setting('t.org_a')::uuid, current_setting('t.title_b')::uuid,
  'master', 'k', 'h', 1, null, null) $$,
  'P0001', null, 'create_asset rejects a title from another org');

-- delivery_ops can, viewer cannot
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.deliv'), 'role', 'authenticated')::text, true);
select lives_ok($$ select public.create_asset(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  'artwork', 'orgs/a/titles/a/artwork/z/key.jpg', 'sha256:ghi', 5, 'image/jpeg', 'key.jpg') $$,
  'delivery_ops: create_asset succeeds');

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.viewer'), 'role', 'authenticated')::text, true);
select throws_ok($$ select public.create_asset(
  current_setting('t.org_a')::uuid, current_setting('t.title_a')::uuid,
  'master', 'k', 'h', 1, null, null) $$,
  'P0001', null, 'viewer: create_asset raises (not operate-capable)');

-- GC staff (all orgs)
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.gc'), 'role', 'authenticated')::text, true);
select lives_ok($$ select public.create_asset(
  current_setting('t.org_b')::uuid, current_setting('t.title_b')::uuid,
  'master', 'orgs/b/titles/b/master/w/f.mxf', 'sha256:jkl', 9, null, null) $$,
  'gc_staff: create_asset succeeds on any org');

reset role;
select * from finish();
rollback;
```

- [ ] **Step 2: Run** — Founder must have applied Task 1's migration first.

Run: `supabase test db`
Expected: `assets_test.sql ... ok`, `All tests successful.`

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/assets_test.sql
git commit -m "test(db): assets — isolation, capability matrix, immutability, cross-org"
```

---

### Task 3: AWS SDK deps, S3 client lib, assets lib, infra runbook

**Files:**
- Modify: `package.json` / `pnpm-lock.yaml` (add deps)
- Create: `src/lib/s3.ts`
- Create: `src/lib/assets.ts`
- Create: `docs/infra/asset-storage-setup.md`

**Interfaces:**
- Produces:
  - `src/lib/s3.ts` (server-only): `S3_BUCKET: string`, `createMultipart(key, contentType?): Promise<string>` (returns uploadId), `signUploadPart(key, uploadId, partNumber, checksumSHA256): Promise<string>` (presigned URL), `completeMultipart(key, uploadId, parts: {PartNumber:number; ETag:string; ChecksumSHA256:string}[]): Promise<string>` (returns composite ChecksumSHA256)
  - `src/lib/assets.ts`: `PART_SIZE = 64 * 1024 * 1024`, `assetKey(orgId, titleId, kind, filename): string`, `resolveOperableTitle(supabase, titleId): Promise<{ orgId: string } | null>`

- [ ] **Step 1: Add dependencies**

Run: `pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner zod`
Expected: added to `package.json` dependencies, lockfile updated.

- [ ] **Step 2: Create `src/lib/s3.ts`**

```ts
import "server-only";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Server-only S3 client. Credentials come from AWS_ACCESS_KEY_ID /
// AWS_SECRET_ACCESS_KEY / AWS_REGION in the environment (never NEXT_PUBLIC).
const region = process.env.AWS_REGION!;
export const S3_BUCKET = process.env.S3_BUCKET!;
const s3 = new S3Client({ region });

const PRESIGN_TTL = 900; // 15 minutes

export async function createMultipart(key: string, contentType?: string): Promise<string> {
  const out = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ChecksumAlgorithm: "SHA256",
    }),
  );
  if (!out.UploadId) throw new Error("S3 did not return an UploadId");
  return out.UploadId;
}

// Presign one UploadPart with its SHA-256 (base64) so S3 verifies integrity and
// the client sends the matching x-amz-checksum-sha256 header.
export async function signUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  checksumSHA256: string,
): Promise<string> {
  return getSignedUrl(
    s3,
    new UploadPartCommand({
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      ChecksumSHA256: checksumSHA256,
    }),
    { expiresIn: PRESIGN_TTL },
  );
}

export async function completeMultipart(
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string; ChecksumSHA256: string }[],
): Promise<string> {
  const out = await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
          .slice()
          .sort((a, b) => a.PartNumber - b.PartNumber)
          .map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag, ChecksumSHA256: p.ChecksumSHA256 })),
      },
    }),
  );
  if (!out.ChecksumSHA256) throw new Error("S3 did not return an object checksum");
  return out.ChecksumSHA256; // composite, e.g. "base64hash-<partCount>"
}
```

- [ ] **Step 3: Create `src/lib/assets.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export const PART_SIZE = 64 * 1024 * 1024; // 64 MiB

// Server-derived S3 key. crypto.randomUUID() namespaces each upload so re-uploads
// never collide. The filename tail is cosmetic; authz never trusts the key.
export function assetKey(
  orgId: string,
  titleId: string,
  kind: string,
  filename: string,
): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120) || "file";
  return `orgs/${orgId}/titles/${titleId}/${kind}/${crypto.randomUUID()}/${safe}`;
}

// Authz for the route handlers: confirm the title is visible to the caller (RLS)
// AND the caller has 'operate' in that title's org. Returns the org id or null.
// (create_asset re-checks at the DB layer; this pre-check avoids presigning for
// someone who can't operate.)
export async function resolveOperableTitle(
  supabase: SupabaseClient<Database>,
  titleId: string,
): Promise<{ orgId: string } | null> {
  const { data: title } = await supabase
    .from("titles")
    .select("org_id")
    .eq("id", titleId)
    .maybeSingle();
  if (!title) return null; // RLS hides other orgs' titles

  const { data: m } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", title.org_id)
    .eq("status", "active")
    .maybeSingle();
  const canOperate = m?.role === "account_owner" || m?.role === "delivery_ops";
  return canOperate ? { orgId: title.org_id } : null;
}
```

- [ ] **Step 4: Create `docs/infra/asset-storage-setup.md`** (founder runbook — `aws` CLI)

```markdown
# Asset storage (S3) setup — run once per environment

Prereqs: `aws` CLI authenticated to the GC AWS account; pick a region (e.g. us-east-1)
and a globally-unique bucket name (e.g. `gc-content-assets-prod`).

    export AWS_REGION=us-east-1
    export BUCKET=gc-content-assets-prod
    export APP_ORIGIN=https://your-app.vercel.app   # and http://localhost:3000 for dev

1) Create the bucket + block all public access:

    aws s3api create-bucket --bucket "$BUCKET" --region "$AWS_REGION" \
      $( [ "$AWS_REGION" = us-east-1 ] || echo --create-bucket-configuration LocationConstraint=$AWS_REGION )
    aws s3api put-public-access-block --bucket "$BUCKET" \
      --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

2) CORS (allow direct part PUTs from the app; expose ETag; allow the checksum header):

    aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration '{
      "CORSRules": [{
        "AllowedOrigins": ["http://localhost:3000", "'"$APP_ORIGIN"'"],
        "AllowedMethods": ["PUT","GET"],
        "AllowedHeaders": ["content-type","x-amz-checksum-sha256","x-amz-sdk-checksum-algorithm"],
        "ExposeHeaders": ["ETag","x-amz-checksum-sha256"],
        "MaxAgeSeconds": 3000
      }]
    }'

3) Lifecycle: abort abandoned multipart uploads after 7 days (Glacier tiering is a later slice):

    aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{
      "Rules": [{
        "ID": "abort-incomplete-multipart",
        "Status": "Enabled",
        "Filter": {"Prefix": ""},
        "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7}
      }]
    }'

4) Least-privilege IAM user for the app (no DeleteObject — nothing is deleted):

    aws iam create-user --user-name gc-assets-app
    aws iam put-user-policy --user-name gc-assets-app --policy-name gc-assets-s3 --policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Action": ["s3:PutObject","s3:GetObject","s3:ListMultipartUploadParts","s3:AbortMultipartUpload"],
        "Resource": "arn:aws:s3:::'"$BUCKET"'/*"
      }]
    }'
    aws iam create-access-key --user-name gc-assets-app   # capture AccessKeyId + SecretAccessKey

5) Set env vars (server-only) locally (`.env.local`) and in Vercel (all environments):

    AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY

Hardening follow-up: replace the long-lived access key with Vercel OIDC → an AWS role
(log to docs/known-divergences.md when done).
```

- [ ] **Step 5: Ask the founder to add the four env var NAMES to `.env.example`** (the file is behind the `.env.*` permission guard, so the assistant cannot edit it): `AWS_REGION=`, `S3_BUCKET=`, `AWS_ACCESS_KEY_ID=`, `AWS_SECRET_ACCESS_KEY=`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`src/lib/s3.ts` is server-only; `assets.ts` types compile.)

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/s3.ts src/lib/assets.ts docs/infra/asset-storage-setup.md
git commit -m "feat(assets): S3 client + assets lib + AWS setup runbook"
```

---

### Task 4: Route handlers — initiate, sign-parts, complete

**Files:**
- Create: `src/app/api/assets/initiate/route.ts`
- Create: `src/app/api/assets/sign-parts/route.ts`
- Create: `src/app/api/assets/complete/route.ts`

**Interfaces:**
- Consumes: `resolveOperableTitle`, `assetKey`, `PART_SIZE` (Task 3); `createMultipart`, `signUploadPart`, `completeMultipart`, `S3_BUCKET` (Task 3); `create_asset` RPC (Task 1); `createClient` (`@/lib/supabase/server`).
- Produces (client contract):
  - `POST /api/assets/initiate` `{ titleId, kind, filename, contentType, bytes }` → `{ uploadId, key, partSize }`
  - `POST /api/assets/sign-parts` `{ titleId, key, uploadId, parts:[{partNumber, checksumSHA256}] }` → `{ urls:[{partNumber, url}] }`
  - `POST /api/assets/complete` `{ titleId, kind, key, uploadId, parts:[{partNumber, etag, checksumSHA256}], bytes, filename, contentType }` → `{ assetId }`

- [ ] **Step 1: Create `initiate/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { resolveOperableTitle, assetKey, PART_SIZE } from "@/lib/assets";
import { createMultipart } from "@/lib/s3";

const Body = z.object({
  titleId: z.string().uuid(),
  kind: z.enum(["master", "caption", "artwork"]),
  filename: z.string().min(1).max(255),
  contentType: z.string().max(255).optional(),
  bytes: z.number().int().nonnegative(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { titleId, kind, filename, contentType } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const op = await resolveOperableTitle(supabase, titleId);
  if (!op) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const key = assetKey(op.orgId, titleId, kind, filename);
  const uploadId = await createMultipart(key, contentType);
  return NextResponse.json({ uploadId, key, partSize: PART_SIZE });
}
```

- [ ] **Step 2: Create `sign-parts/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { resolveOperableTitle } from "@/lib/assets";
import { signUploadPart } from "@/lib/s3";

const Body = z.object({
  titleId: z.string().uuid(),
  key: z.string().min(1),
  uploadId: z.string().min(1),
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(10000), checksumSHA256: z.string().min(1) }))
    .min(1)
    .max(1000),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { titleId, key, uploadId, parts } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const op = await resolveOperableTitle(supabase, titleId);
  if (!op) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  // Bind the key to the caller's org — never sign a key outside their namespace.
  if (!key.startsWith(`orgs/${op.orgId}/titles/${titleId}/`))
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });

  const urls = await Promise.all(
    parts.map(async (p) => ({
      partNumber: p.partNumber,
      url: await signUploadPart(key, uploadId, p.partNumber, p.checksumSHA256),
    })),
  );
  return NextResponse.json({ urls });
}
```

- [ ] **Step 3: Create `complete/route.ts`**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { resolveOperableTitle } from "@/lib/assets";
import { completeMultipart } from "@/lib/s3";

const Body = z.object({
  titleId: z.string().uuid(),
  kind: z.enum(["master", "caption", "artwork"]),
  key: z.string().min(1),
  uploadId: z.string().min(1),
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1), checksumSHA256: z.string().min(1) }))
    .min(1),
  bytes: z.number().int().nonnegative(),
  filename: z.string().max(255).optional(),
  contentType: z.string().max(255).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const b = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const op = await resolveOperableTitle(supabase, b.titleId);
  if (!op) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (!b.key.startsWith(`orgs/${op.orgId}/titles/${b.titleId}/`))
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });

  const contentHash = await completeMultipart(
    b.key,
    b.uploadId,
    b.parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag, ChecksumSHA256: p.checksumSHA256 })),
  );

  const { data: assetId, error } = await supabase.rpc("create_asset", {
    p_org_id: op.orgId,
    p_title_id: b.titleId,
    p_kind: b.kind,
    p_storage_key: b.key,
    p_content_hash: contentHash,
    p_bytes: b.bytes,
    p_content_type: b.contentType ?? undefined,
    p_original_filename: b.filename ?? undefined,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ assetId });
}
```

- [ ] **Step 4: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: green; the three `/api/assets/*` routes appear in the build output.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/assets
git commit -m "feat(assets): presigned multipart route handlers (initiate/sign-parts/complete)"
```

---

### Task 5: Client uploader + wire into `/titles/[id]`

**Files:**
- Create: `src/app/(app)/titles/[id]/asset-upload.tsx`
- Modify: `src/app/(app)/titles/[id]/page.tsx` (add an Assets section: list + uploader)

**Interfaces:**
- Consumes: the three route-handler contracts (Task 4); `Button`, `Input`, `InlineNotice`, `Card`/`CardBody` primitives; `RIGHTS_META` pattern for kind labels (define a local `ASSET_KIND_LABELS`).
- Produces: `<AssetUpload orgId titleId />` client component.

- [ ] **Step 1: Create `asset-upload.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";

type Kind = "master" | "caption" | "artwork";

async function sha256Base64(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  let bin = "";
  const bytes = new Uint8Array(digest);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function putWithRetry(url: string, body: Blob, checksum: string, tries = 3): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: "PUT",
        body,
        headers: { "x-amz-checksum-sha256": checksum },
      });
      if (!res.ok) throw new Error(`part upload failed (${res.status})`);
      const etag = res.headers.get("ETag");
      if (!etag) throw new Error("no ETag returned");
      return etag;
    } catch (e) {
      if (attempt >= tries) throw e;
    }
  }
}

// Multipart upload direct to S3: initiate → per part (hash → sign → PUT) → complete.
export function AssetUpload({ orgId: _orgId, titleId }: { orgId: string; titleId: string }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("master");
  const [file, setFile] = useState<File | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose a file.");
    setError("");
    setPct(0);
    try {
      const init = await fetch("/api/assets/initiate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          titleId, kind, filename: file.name, contentType: file.type || undefined, bytes: file.size,
        }),
      });
      if (!init.ok) throw new Error((await init.json()).error ?? "initiate failed");
      const { uploadId, key, partSize } = await init.json();

      const partCount = Math.max(1, Math.ceil(file.size / partSize));
      const done: { partNumber: number; etag: string; checksumSHA256: string }[] = [];
      for (let i = 0; i < partCount; i++) {
        const partNumber = i + 1;
        const blob = file.slice(i * partSize, Math.min((i + 1) * partSize, file.size));
        const checksum = await sha256Base64(await blob.arrayBuffer());
        const sign = await fetch("/api/assets/sign-parts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ titleId, key, uploadId, parts: [{ partNumber, checksumSHA256: checksum }] }),
        });
        if (!sign.ok) throw new Error((await sign.json()).error ?? "sign failed");
        const { urls } = await sign.json();
        const etag = await putWithRetry(urls[0].url, blob, checksum);
        done.push({ partNumber, etag, checksumSHA256: checksum });
        setPct(Math.round((partNumber / partCount) * 100));
      }

      const complete = await fetch("/api/assets/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          titleId, kind, key, uploadId, parts: done,
          bytes: file.size, filename: file.name, contentType: file.type || undefined,
        }),
      });
      if (!complete.ok) throw new Error((await complete.json()).error ?? "complete failed");

      setFile(null);
      setPct(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setPct(null);
    }
  }

  return (
    <form onSubmit={onUpload} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <select
          aria-label="Asset kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="rounded-[var(--radius-sm)] border border-hairline bg-surface px-2 py-1 t-body-sm text-ink"
        >
          <option value="master">Master</option>
          <option value="caption">Caption</option>
          <option value="artwork">Artwork</option>
        </select>
        <input
          type="file"
          aria-label="Asset file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="t-body-sm text-ink-2"
        />
        <Button type="submit" disabled={pct !== null || !file} className="shrink-0">
          {pct !== null ? `Uploading ${pct}%` : "Upload"}
        </Button>
      </div>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
    </form>
  );
}
```

- [ ] **Step 2: Add the Assets section to `page.tsx`**

Add imports at the top of `src/app/(app)/titles/[id]/page.tsx`:

```tsx
import { AssetUpload } from "./asset-upload";

const ASSET_KIND_LABELS: Record<"master" | "caption" | "artwork", string> = {
  master: "Master",
  caption: "Caption",
  artwork: "Artwork",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}
```

After the existing rights-grants block (before the closing `</>`), add the assets query + section. Place this fetch next to the grants fetch:

```tsx
  const { data: assets } = await supabase
    .from("assets")
    .select("id, kind, original_filename, bytes, received_at")
    .eq("title_id", id)
    .order("received_at", { ascending: false });
  const assetList = assets ?? [];
```

And render (after the grants section):

```tsx
      <div className="mt-10">
        <h2 className="t-body font-medium text-ink pb-3">Assets</h2>
        {canOperate ? (
          <div className="mb-4 max-w-xl">
            <AssetUpload orgId={title.org_id} titleId={title.id} />
          </div>
        ) : null}
        {assetList.length === 0 ? (
          <Card>
            <CardBody>
              <p className="t-body-sm text-ink-3">No assets uploaded yet.</p>
            </CardBody>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {assetList.map((a) => (
              <Card key={a.id}>
                <CardBody className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="t-body font-medium text-ink">
                      {a.original_filename ?? ASSET_KIND_LABELS[a.kind]}
                    </span>
                    <span className="t-body-sm text-ink-3">
                      {ASSET_KIND_LABELS[a.kind]} · {formatBytes(a.bytes)}
                    </span>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>
```

- [ ] **Step 3: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/titles/[id]"
git commit -m "feat(assets): client multipart uploader + assets section on title detail"
```

---

### Task 6: Verify end-to-end + leak-check

**Files:** none (verification only).

- [ ] **Step 1: Full DB suite** — Run: `supabase test db` — Expected: `All tests successful.` (incl. `assets_test.sql`).
- [ ] **Step 2: App checks** — Run: `npm run typecheck && npm run lint && npm run build` — Expected: all green.
- [ ] **Step 3: Leak-check** — Invoke the `leak-check` skill. Expected: no `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `S3_BUCKET` values or names in `.next/static`; server-only `import "server-only"` in `s3.ts` prevents client bundling.
- [ ] **Step 4: Manual (founder, after bucket exists + env set):** on `/titles/[id]` as an operate-capable user, upload a multi-part file (>64 MiB to exercise ≥2 parts) → object appears in S3, `assets` row has correct `content_hash`/`bytes`, the file lists; a `viewer` sees the list but no uploader.
- [ ] **Step 5: Commit any fixups** — `git add -A && git commit -m "chore(assets): verification fixups"`

---

## Self-Review

**1. Spec coverage:**
- `asset_kind` enum + `assets` table (immutable, indexes) → Task 1 ✓
- RLS + audit trigger → Task 1 ✓
- `create_asset` RPC (operate-gated, title∈org, written on complete) → Task 1 ✓
- Presigned multipart route handlers (initiate/sign-parts/complete) → Task 4 ✓
- Direct-to-S3 part PUTs, never proxied → Task 5 client (PUT to presigned URL) ✓
- S3 SHA-256 integrity → `content_hash` → Task 3 (`ChecksumAlgorithm`/`ChecksumSHA256`) + Task 5 (per-part hash) ✓
- Keys in Postgres never URLs → `storage_key` column; no URL stored ✓
- Client upload UI on `/titles/[id]` → Task 5 ✓
- `aws` CLI setup (bucket/CORS/IAM/lifecycle) → Task 3 runbook ✓
- Server-only AWS creds + leak-check → Task 3 (`server-only`) + Task 6 ✓
- pgTAP (isolation, capability, immutability, cross-org) → Task 2 ✓
- Seams (download signing, Glacier restoring, purge, cross-session resume, OIDC) → excluded, noted in header + Task 1 comment ✓

**2. Placeholder scan:** No TBD/TODO. Env values are founder-supplied at runtime (documented in the runbook, not hardcoded). All code blocks are complete.

**3. Type consistency:** Client contracts (`{uploadId,key,partSize}`, `{urls}`, `{assetId}`) match between Task 4 handlers and Task 5 client. `create_asset` 8-arg signature matches Task 1 (SQL), Task 4 (`.rpc` call). `resolveOperableTitle`/`assetKey`/`PART_SIZE`/`createMultipart`/`signUploadPart`/`completeMultipart` names match between Task 3 definitions and Task 4 use. `Kind` union (`master|caption|artwork`) is consistent across enum, zod, and client.

**Note on `sign-parts` batch vs per-part:** the handler accepts an array (`parts[]`), the Task-5 client calls it one part at a time (single-element array) for a single file read + immediate retry. Both honor the same contract.
