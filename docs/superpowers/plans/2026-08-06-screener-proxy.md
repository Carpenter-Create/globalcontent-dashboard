# Screener Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate one small, web-playable screener proxy per uploaded master, so the buyer title page has something it can actually show.

**Architecture:** Master upload completes → submit an AWS Elemental MediaConvert job whose output key is decided *at submit time* and recorded → MediaConvert emits completion on EventBridge → an authenticated callback route looks the job up by id, verifies the object at the recorded key, and registers it as a `screener` asset through a service-role RPC that also flips `screener_source` when it is still at its default. Nothing trusts the event payload except the job id.

**Tech Stack:** Next.js App Router (Node runtime), Supabase Postgres with SECURITY DEFINER RPCs, `@aws-sdk/client-mediaconvert` (new dependency), `@aws-sdk/client-s3` (existing), Vitest, pgTAP.

## Global Constraints

- **Source spec:** `docs/superpowers/specs/2026-08-06-screener-proxy-design.md`. It governs; this plan implements it.
- **Package manager is `pnpm`.** Never `npm install`.
- **Destructive-ops rule:** migrations, RLS/policy and permission changes require the exact SQL shown to the founder and explicit approval before applying. A `PreToolUse` hook blocks the apply command; the founder runs it. **Implementers must never run `supabase`, `psql`, or any AWS CLI command.**
- **Every RPC parameter a caller may omit must be declared `… default null`**, or generated TS types mark it required. This repo has been bitten four times.
- **Independent Supabase queries in a server component must be `Promise.all`'d.**
- **Never call `supabase.auth.getUser()`** — use `getAuthUser()` / `getOrgContext()` from `lib/supabase`.
- **Secrets are server-only.** Never `NEXT_PUBLIC_`. Never read or print `.env.local`.
- **Nothing is ever deleted** — status changes and supersession only.
- **`audit_log` is append-only**; write to it from SECURITY DEFINER functions, never a table-wide trigger that copies whole rows (a trigger on a row carrying a token was this repo's most recent Critical).
- **Design tokens only** — never hardcode hex. **Banned copy words:** seamless, frictionless, white-glove, elevate, amplify, unleash, supercharge, best-in-class, effortless, unlock, game-changing.
- **Verification per task:** `pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build`. Baseline for clean: 0 eslint errors and exactly 5 pre-existing warnings in `src`. `pnpm lint` is red from `.claude/worktrees`; lint `src` only.

## Two founder decisions, already made — implement exactly these

1. **The `screener_source` flip applies ONLY when the current value is still `'master'`.** If a client has explicitly chosen `'dedicated'`, register the proxy but leave the setting alone. Never override an explicit choice.
2. **The backfill runs in one pass over ~700 masters, and is a runbook the founder executes.** No task in this plan spends money or submits a bulk job.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `docs/infra/screener-proxy-setup.md` (create) | Paste-able AWS runbook: IAM role, job template, EventBridge rule + API destination, verification. |
| `supabase/migrations/20260807000100_transcode_jobs.sql` (create) | `transcode_jobs` table, RLS, and `register_transcode_output` / `fail_transcode_job` RPCs. |
| `src/lib/mediaconvert-settings.ts` (create) | **Pure.** Output key derivation and job-settings construction. No AWS calls, fully unit-tested. |
| `src/lib/mediaconvert.ts` (create) | The AWS client and `submitProxyJob`. Thin — all logic lives in the settings module. |
| `src/app/api/assets/complete/route.ts` (modify) | Submit on `kind === 'master'`, best-effort. |
| `src/app/api/transcode/callback/route.ts` (create) | Authenticated EventBridge receiver. |
| `src/lib/transcode-callback.ts` (create) | **Pure.** Event parsing and the accept/reject decision, unit-tested apart from I/O. |
| `src/app/(app)/(operator)/gc/titles/[id]/transcode-panel.tsx` (create) | GC job status + retry. |
| `docs/domain-spec.md` (modify) | The §12 amendment. |
| `docs/infra/screener-proxy-backfill.md` (create) | Backfill runbook. |

---

### Task 1: The AWS runbook

No application code. This is what the founder applies before anything else can work, and this repo has shipped a runbook whose lifecycle filter matched **zero objects** while showing green in the console — so the verification steps are the point of this task, not a footnote.

**Files:**
- Create: `docs/infra/screener-proxy-setup.md`

**Interfaces:**
- Produces: the env var names later tasks read — `MEDIACONVERT_ENDPOINT`, `MEDIACONVERT_ROLE_ARN`, `MEDIACONVERT_QUEUE_ARN`, `TRANSCODE_CALLBACK_SECRET`.

- [ ] **Step 1: Write the runbook**

Follow the structure of `docs/infra/portal-go-live-runbook.md` — a fill-in-your-values block first, then numbered steps each with a **verify** command. Cover:

1. **IAM role for MediaConvert.** Trust policy for `mediaconvert.amazonaws.com`. Permissions: `s3:GetObject` on `arn:aws:s3:::$BUCKET/orgs/*/master/*` and `s3:PutObject` on `arn:aws:s3:::$BUCKET/orgs/*/screener/*`. **Not bucket-wide** — the spec requires read on masters and write on screeners only.
2. **Account-specific MediaConvert endpoint.** `aws mediaconvert describe-endpoints --query "Endpoints[0].Url" --output text`. This is per-account and per-region; the SDK needs it.
3. **No job template.** Encoding settings are submitted inline by `buildProxyJobSettings` (Task 3) so they live in version control and are unit-tested, rather than in console state nobody can diff. Say so explicitly in the runbook — otherwise someone will helpfully create one and the two will drift.
4. **EventBridge rule** matching `source = aws.mediaconvert`, `detail-type = "MediaConvert Job State Change"`, `detail.status` in `["COMPLETE","ERROR","CANCELED"]`.
5. **API destination + connection** with API-key auth so EventBridge injects a header. The header name and the secret become `TRANSCODE_CALLBACK_SECRET`. Point it at `$APP_ORIGIN/api/transcode/callback`.
6. **Env vars** set locally and in Vercel: the four above. Note explicitly that `TRANSCODE_CALLBACK_SECRET` is server-only and must never be `NEXT_PUBLIC_`.

- [ ] **Step 2: Write the verification section — this is the part that matters**

A green console does not mean a working pipeline. Each verify must prove *selection and delivery*, not existence:

- Submit one real job from the CLI against a known master key and confirm an output object appears at the expected prefix.
- Confirm the EventBridge rule actually matched: `aws events test-event-pattern` with a sample MediaConvert COMPLETE event, expecting `true`.
- Confirm the API destination delivered: check the rule's invocation metrics, or send a test event and observe a request reaching the app.
- **Confirm the proxy is NOT archive-tagged.** `aws s3api get-object-tagging` on the produced output must come back with no `gc-archive` tag. Masters are tagged at `CreateMultipartUpload` and the Glacier lifecycle rule selects on that tag, so a MediaConvert-written object is untagged and stays instant *by default* — but the whole point of this slice is a screener that never goes cold, and "correct by accident" is worth one command to confirm.
- State plainly that a rule which matches nothing looks identical to a rule that works.

- [ ] **Step 3: Commit**

```bash
git add docs/infra/screener-proxy-setup.md
git commit -m "docs(infra): MediaConvert screener proxy setup runbook"
```

---

### Task 2: `transcode_jobs` and its RPCs

**This task contains destructive SQL. Show the founder the exact statements. Do NOT apply it, and do NOT run any database command.**

**Files:**
- Create: `supabase/migrations/20260807000100_transcode_jobs.sql`
- Modify: `supabase/tests/` — add `transcode_jobs_test.sql`

**Interfaces:**
- Produces: table `public.transcode_jobs`; enum `public.transcode_status` = `('submitted','running','complete','failed','submit_failed')`
- Produces: `register_transcode_output(p_job_id uuid, p_storage_key text, p_bytes bigint, p_content_hash text) returns uuid` — service_role only
- Produces: `fail_transcode_job(p_job_id uuid, p_reason text default null) returns void` — service_role only
- Produces: `create_transcode_job(p_org_id uuid, p_title_id uuid, p_source_asset_id uuid, p_expected_output_key text, p_external_job_id text default null) returns uuid` — authenticated, operate-gated

- [ ] **Step 1: Write the table**

```sql
do $$ begin create type public.transcode_status as enum
  ('submitted','running','complete','failed','submit_failed');
exception when duplicate_object then null; end $$;

create table if not exists public.transcode_jobs (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete restrict,
  title_id            uuid not null references public.titles(id)        on delete restrict,
  source_asset_id     uuid not null references public.assets(id)        on delete restrict,
  output_asset_id     uuid references public.assets(id)                 on delete restrict,
  -- Decided at SUBMIT time and never taken from the completion event. The callback
  -- verifies an object exists HERE; it does not learn the key from AWS. That is what
  -- stops a forged event registering an arbitrary S3 key as a screener.
  expected_output_key text not null,
  external_job_id     text unique,
  status              public.transcode_status not null default 'submitted',
  failure_reason      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz
);
create index if not exists transcode_jobs_title_idx  on public.transcode_jobs (title_id);
create index if not exists transcode_jobs_status_idx on public.transcode_jobs (status, created_at);
```

- [ ] **Step 2: RLS — read for the owning org and GC, no client writes**

```sql
alter table public.transcode_jobs enable row level security;
revoke insert, update, delete on public.transcode_jobs from authenticated, anon;

drop policy if exists transcode_jobs_select on public.transcode_jobs;
create policy transcode_jobs_select on public.transcode_jobs for select to authenticated
  using (public.member_can(auth.uid(), org_id, 'view'));
```

`member_can` routes a GC caller through `gc_can`, so GC sees all orgs and a client sees its own — the same single predicate used everywhere else in this repo. All writes go through the RPCs below.

- [ ] **Step 3: `create_transcode_job` — operate-gated, called from the upload path**

```sql
create or replace function public.create_transcode_job(
  p_org_id            uuid,
  p_title_id          uuid,
  p_source_asset_id   uuid,
  p_expected_output_key text,
  p_external_job_id   text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not public.member_can(auth.uid(), p_org_id, 'operate') then
    raise exception 'Not authorized';
  end if;
  insert into public.transcode_jobs
    (org_id, title_id, source_asset_id, expected_output_key, external_job_id, status)
  values (p_org_id, p_title_id, p_source_asset_id, btrim(p_expected_output_key),
          nullif(btrim(p_external_job_id), ''), 'submitted')
  returning id into v_id;
  return v_id;
end; $$;

revoke execute on function public.create_transcode_job(uuid, uuid, uuid, text, text) from public, anon;
grant  execute on function public.create_transcode_job(uuid, uuid, uuid, text, text) to authenticated;
```

- [ ] **Step 4: `register_transcode_output` — the security-critical one**

Everything it writes is derived from the JOB ROW, never from the caller beyond the job id and the verified object facts.

```sql
create or replace function public.register_transcode_output(
  p_job_id       uuid,
  p_storage_key  text,
  p_bytes        bigint,
  p_content_hash text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_job public.transcode_jobs; v_asset_id uuid; v_source public.screener_source;
begin
  select * into v_job from public.transcode_jobs where id = p_job_id;
  if not found then raise exception 'Job not found'; end if;

  -- Idempotent: a duplicate EventBridge delivery must not register a second asset.
  if v_job.status = 'complete' then return v_job.output_asset_id; end if;

  -- The key is NOT taken on trust. It must equal what we recorded at submit time.
  if btrim(p_storage_key) <> v_job.expected_output_key then
    raise exception 'Output key does not match the job';
  end if;

  insert into public.assets (org_id, title_id, kind, storage_key, content_hash, bytes, content_type)
  values (v_job.org_id, v_job.title_id, 'screener', v_job.expected_output_key,
          p_content_hash, p_bytes, 'video/mp4')
  returning id into v_asset_id;

  -- Founder decision: flip ONLY from the default. An explicit 'dedicated' choice by the
  -- client is theirs and must survive.
  select screener_source into v_source from public.titles where id = v_job.title_id;
  if v_source = 'master' then
    update public.titles set screener_source = 'dedicated' where id = v_job.title_id;
  end if;

  update public.transcode_jobs
     set status = 'complete', output_asset_id = v_asset_id,
         completed_at = now(), updated_at = now()
   where id = p_job_id;

  insert into public.audit_log (org_id, entity, entity_id, action, actor, after)
  values (v_job.org_id, 'transcode_jobs', p_job_id, 'proxy_registered', null,
          jsonb_build_object('asset_id', v_asset_id, 'flipped_source', v_source = 'master'));

  return v_asset_id;
end; $$;

revoke execute on function public.register_transcode_output(uuid, text, bigint, text) from public, anon, authenticated;
grant  execute on function public.register_transcode_output(uuid, text, bigint, text) to service_role;
```

Note the audit row carries **ids and a boolean only** — no keys, no names. A previous migration in this repo was rejected for copying whole rows containing a live token into `audit_log`.

- [ ] **Step 5: `fail_transcode_job`**

```sql
create or replace function public.fail_transcode_job(p_job_id uuid, p_reason text default null)
  returns void language plpgsql security definer set search_path = public as $$
begin
  update public.transcode_jobs
     set status = 'failed', failure_reason = nullif(btrim(p_reason), ''), updated_at = now()
   where id = p_job_id and status <> 'complete';
  if not found then raise exception 'Job not found or already complete'; end if;
end; $$;

revoke execute on function public.fail_transcode_job(uuid, text) from public, anon, authenticated;
grant  execute on function public.fail_transcode_job(uuid, text) to service_role;
```

- [ ] **Step 6: pgTAP**

Create `supabase/tests/transcode_jobs_test.sql`. Assert, at minimum:
- a client with `operate` can `create_transcode_job` for their own org; a `viewer` cannot; another org's member cannot
- `register_transcode_output` is NOT executable by `authenticated` (`throws_ok` on permission denied)
- a mismatched `p_storage_key` raises `'Output key does not match the job'`
- calling `register_transcode_output` twice returns the same asset id and creates exactly ONE screener asset
- the flip happens when `screener_source = 'master'` and does NOT happen when it is `'dedicated'`
- the audit row contains neither `storage_key` nor any filename

Set `plan(N)` by counting the helpers yourself. Identity state via `set_config(..., true)` is transaction-local and leaks forward — switch to the identity each assertion needs and restore before the next block.

- [ ] **Step 7: Show the founder the SQL and stop**

Print the full migration. State what it creates and that no existing table or row is touched. **Do not apply it.**

---

### Task 3: Pure output-key and job-settings derivation

**Files:**
- Create: `src/lib/mediaconvert-settings.ts`
- Test: `src/lib/mediaconvert-settings.test.ts`

**Interfaces:**
- Produces: `proxyOutputKey(masterKey: string): { destination: string; nameModifier: string; expectedKey: string }`
- Produces: `buildProxyJobSettings(input: { masterKey: string; bucket: string }): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { proxyOutputKey, buildProxyJobSettings } from "@/lib/mediaconvert-settings";

const MASTER = "orgs/org-1/titles/title-1/master/uuid-1/The Long Quiet.mov";

describe("proxyOutputKey", () => {
  it("writes the proxy beside the master under a screener prefix on the same title", () => {
    const o = proxyOutputKey(MASTER);
    expect(o.destination).toBe("orgs/org-1/titles/title-1/screener/uuid-1/");
    expect(o.expectedKey).toBe("orgs/org-1/titles/title-1/screener/uuid-1/The Long Quiet_screener.mp4");
  });

  it("derives the key deterministically — the same master always yields the same output", () => {
    expect(proxyOutputKey(MASTER).expectedKey).toBe(proxyOutputKey(MASTER).expectedKey);
  });

  it("refuses a key that is not a master, rather than writing somewhere unexpected", () => {
    expect(() => proxyOutputKey("orgs/o/titles/t/screener/u/x.mp4")).toThrow();
    expect(() => proxyOutputKey("../../etc/passwd")).toThrow();
    expect(() => proxyOutputKey("")).toThrow();
  });
});

describe("buildProxyJobSettings", () => {
  it("reads from the master and writes to the derived destination", () => {
    const s = buildProxyJobSettings({ masterKey: MASTER, bucket: "b" }) as never as {
      Inputs: { FileInput: string }[];
      OutputGroups: { OutputGroupSettings: { FileGroupSettings: { Destination: string } } }[];
    };
    expect(s.Inputs[0].FileInput).toBe(`s3://b/${MASTER}`);
    expect(s.OutputGroups[0].OutputGroupSettings.FileGroupSettings.Destination)
      .toBe("s3://b/orgs/org-1/titles/title-1/screener/uuid-1/");
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `pnpm exec vitest run src/lib/mediaconvert-settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`proxyOutputKey` must parse `orgs/<org>/titles/<title>/master/<uuid>/<filename>` with an anchored regex and throw on anything else — the output destination is a place we are about to WRITE, so a malformed input must stop rather than resolve somewhere surprising. Reuse the same `<uuid>` segment so the proxy is traceable to its master. Strip the input extension and append `_screener.mp4`.

`buildProxyJobSettings` returns the MediaConvert `Settings` object: one input reading `s3://<bucket>/<masterKey>`, one File output group whose destination is `s3://<bucket>/<destination>`, an H.264 1080p ~2.5 Mbps VBR video description, an AAC 128k audio description, MP4 container with `FastStart`. Keep it data — no AWS SDK import in this file.

- [ ] **Step 4: Run and verify it passes**

Run: `pnpm exec vitest run src/lib/mediaconvert-settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/mediaconvert-settings.ts src/lib/mediaconvert-settings.test.ts
git commit -m "feat(transcode): deterministic proxy output key and job settings"
```

---

### Task 4: Submit the job on master completion

**Files:**
- Create: `src/lib/mediaconvert.ts`
- Modify: `src/app/api/assets/complete/route.ts`
- Test: `src/app/api/assets/complete/route.test.ts`

**Interfaces:**
- Consumes: `proxyOutputKey`, `buildProxyJobSettings` (Task 3); `create_transcode_job` (Task 2)
- Produces: `submitProxyJob(input: { masterKey: string }): Promise<{ externalJobId: string; expectedKey: string }>`

- [ ] **Step 1: Add the dependency**

```bash
pnpm add @aws-sdk/client-mediaconvert
```

- [ ] **Step 2: Write `src/lib/mediaconvert.ts`**

`import "server-only";` at the top, matching `src/lib/s3.ts`. Construct a `MediaConvertClient` with `endpoint: process.env.MEDIACONVERT_ENDPOINT` and the region. `submitProxyJob` calls `proxyOutputKey`, then `CreateJobCommand` with `Role: process.env.MEDIACONVERT_ROLE_ARN`, `Queue: process.env.MEDIACONVERT_QUEUE_ARN`, and the settings from Task 3. Return the AWS job id and the expected key. Keep this file thin — no branching logic.

- [ ] **Step 3: Hook the completion route — best-effort, never fails the upload**

After the existing `create_asset` call succeeds, and only when `b.kind === "master"`:

```ts
  // Best-effort. The master is already in S3 and the asset row is written; a transcode
  // failure must never lose the client's upload. A missing proxy degrades the buyer page
  // to exactly what it does today, which is a missing improvement, not a regression.
  if (b.kind === "master" && assetId) {
    try {
      const { externalJobId, expectedKey } = await submitProxyJob({ masterKey: b.key });
      await supabase.rpc("create_transcode_job", {
        p_org_id: op.orgId,
        p_title_id: b.titleId,
        p_source_asset_id: assetId,
        p_expected_output_key: expectedKey,
        p_external_job_id: externalJobId,
      });
    } catch (e) {
      console.error(`[transcode:submit] ${e instanceof Error ? e.message : e}`);
    }
  }
```

**Order matters:** submit first, then record. If the submit throws there is no job to record; if the record throws we log a job that exists in AWS but not in our table, which the reconcile pass in Task 6 is designed to find.

- [ ] **Step 4: Write the tests**

Follow the Supabase-mock pattern already in `src/app/(app)/titles/[id]/actions.test.ts`. Assert:
- a `master` upload submits and records a job
- a `trailer` / `poster` upload does NOT submit
- **a submit that throws still returns 200 with the assetId** — mutation-check this one by removing the try/catch and confirming the test fails
- a `create_transcode_job` RPC error is logged and still returns 200

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build`

```bash
git add src/lib/mediaconvert.ts src/app/api/assets/complete package.json pnpm-lock.yaml
git commit -m "feat(transcode): submit a proxy job when a master lands"
```

---

### Task 5: The authenticated callback

This is the highest-risk task in the plan. The route is public and it registers an asset the buyer page will serve.

**Files:**
- Create: `src/lib/transcode-callback.ts`
- Create: `src/lib/transcode-callback.test.ts`
- Create: `src/app/api/transcode/callback/route.ts`
- Create: `src/app/api/transcode/callback/route.test.ts`

**Interfaces:**
- Consumes: `register_transcode_output`, `fail_transcode_job` (Task 2)
- Produces: `parseTranscodeEvent(body: unknown): { externalJobId: string; status: "complete" | "failed"; reason?: string } | null`

- [ ] **Step 1: Write the pure parser and its tests first**

`parseTranscodeEvent` validates with zod and returns `null` for anything unrecognised. It reads ONLY `detail.jobId` and `detail.status`, mapping `COMPLETE` → `complete` and `ERROR`/`CANCELED` → `failed`. **It must not read any key, bucket, title or org from the event** — those come from the job row. Test that a payload containing an `outputKey` or `titleId` field is ignored entirely.

- [ ] **Step 2: Write the route**

In order, refusing at each step:

1. **Authenticate.** Read the shared-secret header set by the EventBridge API destination and compare with `safeEqualHex`-style timing-safe equality against `process.env.TRANSCODE_CALLBACK_SECRET`. Missing or wrong → **401**, and log nothing that echoes the supplied value. If the env var is unset, refuse — never fail open.
2. **Parse.** `parseTranscodeEvent` → null means **400**.
3. **Resolve the job** by `external_job_id` using the admin client. Not found → **404**. Everything downstream uses this row.
4. **On `failed`:** call `fail_transcode_job` and return 200.
5. **On `complete`:** `HeadObject` the job's `expected_output_key` to obtain real `bytes` and the ETag as `content_hash`. If the object is absent, call `fail_transcode_job` with that reason and return 200 — do not register an asset for an object that is not there.
6. Call `register_transcode_output(jobId, expectedKey, bytes, contentHash)`. Return 200.

Never derive anything from the request body beyond the job id and the status.

- [ ] **Step 3: Write the route tests, and mutation-check the authentication**

Assert: no header → 401 and **no RPC called**; wrong header → 401 and no RPC; valid header + unknown job → 404; `ERROR` status → `fail_transcode_job`, no asset; `COMPLETE` with a missing object → `fail_transcode_job`, no asset; `COMPLETE` with the object present → `register_transcode_output` with the key **from the job row**, not from the body; a body carrying a different `outputKey` is ignored.

**Mutation-check:** delete the auth check, confirm the first two tests fail, restore, confirm green. Report the observed output — do not reason about it.

- [ ] **Step 4: Verify and commit**

Run: `pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build`

```bash
git add src/lib/transcode-callback.ts src/lib/transcode-callback.test.ts src/app/api/transcode
git commit -m "feat(transcode): authenticated completion callback"
```

---

### Task 6: Reconcile lost events

Without this, a dropped EventBridge delivery means a title silently never gets a proxy — and nothing surfaces it.

**Files:**
- Create: `src/app/api/cron/transcode-reconcile/route.ts`
- Test: `src/app/api/cron/transcode-reconcile/route.test.ts`

**Interfaces:**
- Consumes: `submitProxyJob`'s client (Task 4), `register_transcode_output` / `fail_transcode_job` (Task 2)

- [ ] **Step 1: Look at how this repo already schedules work**

Read `docs/scheduled/subscription-lifecycle.md` and follow whatever authentication and scheduling pattern it establishes for cron routes. Do not invent a second one.

- [ ] **Step 2: Implement**

Select `transcode_jobs` rows in `submitted` or `running` older than 30 minutes, bounded via `@/lib/list-bounds`. For each, `GetJobCommand` against MediaConvert and resolve to the same two outcomes as the callback — complete registers, error fails. Reuse the callback's logic rather than duplicating the decision.

- [ ] **Step 3: Test**

A stale `submitted` job whose AWS state is COMPLETE gets registered; one that is ERROR gets failed; a fresh job is left alone; a job already `complete` is skipped.

- [ ] **Step 4: Verify and commit**

```bash
git add src/app/api/cron/transcode-reconcile
git commit -m "feat(transcode): reconcile jobs whose completion event never arrived"
```

---

### Task 7: GC visibility and retry

A failed transcode that nobody can see is the same as no pipeline.

**Files:**
- Create: `src/app/(app)/(operator)/gc/titles/[id]/transcode-panel.tsx`
- Modify: `src/app/(app)/(operator)/gc/titles/[id]/page.tsx`
- Modify: `src/app/(app)/(operator)/gc/titles/[id]/actions.ts`

- [ ] **Step 1: Panel**

List the title's `transcode_jobs`: status, created, failure reason, and the resulting screener asset when complete. Bounded read via `@/lib/list-bounds`, inside the page's existing `Promise.all`. Design tokens only; reuse `Card`, `InlineNotice`, `Button`.

- [ ] **Step 2: Retry action**

A server action that re-submits for the job's source asset and records a new job row. Gate on GC operate — the RPC already enforces it; the UI must not offer it to a role that would be refused.

- [ ] **Step 3: Verify and commit**

```bash
git add "src/app/(app)/(operator)/gc/titles/[id]"
git commit -m "feat(gc): transcode job status and retry"
```

---

### Task 8: The domain-spec amendment

**Files:**
- Modify: `docs/domain-spec.md` §12

- [ ] **Step 1: Add the exception**

Insert under §12, after the existing "GC does not transcode" paragraph, the wording from the design spec §3 verbatim:

> **Exception — internal viewing proxies.** GC generates one low-bitrate screener proxy per master, for viewing and evaluation only. It is never delivered to a vendor and never satisfies a delivery requirement. This is not a transcoding pipeline in the sense above: GC still does not re-encode deliverables, and clients still deliver platform-ready masters.

Do not soften or broaden it. The point is that §12's original rule survives.

- [ ] **Step 2: Update `CLAUDE.md`'s deferred list**

It currently reads `**transcoding** (clients deliver platform-ready; GC never transcodes)`. Amend to record that internal viewing proxies are now built, deliverable re-encoding is still never done.

- [ ] **Step 3: Commit**

```bash
git add docs/domain-spec.md CLAUDE.md
git commit -m "docs(spec): §12 exception for internal viewing proxies"
```

---

### Task 9: The backfill runbook

**Files:**
- Create: `docs/infra/screener-proxy-backfill.md`

**This task writes a document. It does NOT run a backfill and does not submit any job.**

- [ ] **Step 1: Write it**

Cover: how to list masters lacking a screener (SQL the founder runs), how to submit jobs in batches with a concurrency limit, how to monitor progress against `transcode_jobs`, the expected cost (~$1 per feature, ~$700 for ~700 titles), and how to re-run safely for failures only.

State plainly that titles whose `screener_source` is already `'dedicated'` still get a proxy registered but keep their setting, per the founder decision.

- [ ] **Step 2: Commit**

```bash
git add docs/infra/screener-proxy-backfill.md
git commit -m "docs(infra): screener proxy backfill runbook"
```

---

## Not in this plan

- Multiple renditions or adaptive bitrate. One proxy.
- Watermarking or DRM — the untraceable-copy tradeoff was accepted for the buyer page and is unchanged.
- Re-encoding anything delivered to a vendor. §12's actual rule stands.
- Caption burn-in, trailer or artwork processing.
- **Executing the backfill.** Founder-run, by design.
