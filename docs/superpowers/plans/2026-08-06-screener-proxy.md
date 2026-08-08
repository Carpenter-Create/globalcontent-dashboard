# Screener Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate one small, web-playable screener proxy per uploaded master, so the buyer title page has something it can actually show.

**Architecture:** Master upload completes → submit an AWS Elemental MediaConvert job whose output key is decided *at submit time* and recorded → a scheduled poll asks MediaConvert about jobs still in flight, looks each one up by id, verifies the object at the recorded key, and registers it as a `screener` asset through a service-role RPC that also flips `screener_source` when it is still at its default. Nothing is trusted from AWS beyond a job's id and terminal status; the output key, org, and title all come from the job row.

**Amended 2026-08-07:** the original architecture here had MediaConvert push completion through EventBridge to a public, authenticated callback route. The founder chose a scheduled poll instead — no public write endpoint, roughly half the AWS setup removed, one mechanism instead of two, and testable locally. See `docs/superpowers/specs/2026-08-06-screener-proxy-design.md` §5 for the full reasoning and the accepted costs (poll-interval latency; dependence on the scheduler running, mitigated by the stuck-jobs signal in Task 5 below). This plan's Tasks 5 and 6 are merged into one task as a result.

**Tech Stack:** Next.js App Router (Node runtime) with Vercel Cron, Supabase Postgres with SECURITY DEFINER RPCs, `@aws-sdk/client-mediaconvert` (new dependency), `@aws-sdk/client-s3` (existing), Vitest, pgTAP.

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

## Three founder decisions, already made — implement exactly these

1. **The `screener_source` flip applies ONLY when the current value is still `'master'`.** If a client has explicitly chosen `'dedicated'`, register the proxy but leave the setting alone. Never override an explicit choice.
2. **The backfill runs in one pass over ~700 masters, and is a runbook the founder executes.** No task in this plan spends money or submits a bulk job.
3. **Completion is discovered by a scheduled poll, not a pushed EventBridge callback.** No public write endpoint, no shared secret, no EventBridge rule or API destination. See the spec's §5 amendment for the reasoning and its accepted costs.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `docs/infra/screener-proxy-setup.md` (create) | Paste-able AWS runbook: MediaConvert IAM role, account endpoint, queue, the app's own `mediaconvert:GetJob`/`ListJobs` grant, verification. No EventBridge, no API destination, no callback secret. |
| `supabase/migrations/20260807000100_transcode_jobs.sql` (create) | `transcode_jobs` table, RLS, and `register_transcode_output` / `fail_transcode_job` RPCs. |
| `src/lib/mediaconvert-settings.ts` (create) | **Pure.** Output key derivation and job-settings construction. No AWS calls, fully unit-tested. |
| `src/lib/mediaconvert.ts` (create) | The AWS client and `submitProxyJob`. Thin — all logic lives in the settings module. |
| `src/app/api/assets/complete/route.ts` (modify) | Submit on `kind === 'master'`, best-effort. |
| `vercel.json` (create) | Registers the scheduled poll with Vercel Cron — the first cron declaration in this repo, shaped so the subscription-lapse job (`docs/scheduled/subscription-lifecycle.md`) can add its own entry to the same `crons` array later. |
| `src/app/api/cron/transcode-poll/route.ts` (create) | The scheduled poll. Authenticates the Vercel cron dispatcher, selects in-flight jobs (bounded), resolves each against MediaConvert, registers or fails, surfaces a stuck-jobs count. |
| `src/lib/transcode-poll.ts` (create) | **Pure.** The accept/reject decision for a MediaConvert `GetJob` response — COMPLETE/ERROR/CANCELED mapping — unit-tested apart from I/O. |
| `src/app/(app)/(operator)/gc/titles/[id]/transcode-panel.tsx` (create) | GC job status + retry. |
| `docs/domain-spec.md` (modify) | The §12 amendment. |
| `docs/infra/screener-proxy-backfill.md` (create) | Backfill runbook. |

---

### Task 1: The AWS runbook

No application code. This is what the founder applies before anything else can work, and this repo has shipped a runbook whose lifecycle filter matched **zero objects** while showing green in the console — so the verification steps are the point of this task, not a footnote.

**Files:**
- Create: `docs/infra/screener-proxy-setup.md`

**Interfaces:**
- Produces: the env var names later tasks read — `MEDIACONVERT_ENDPOINT`, `MEDIACONVERT_ROLE_ARN`, `MEDIACONVERT_QUEUE_ARN`. No callback secret — completion is discovered by polling, not by a pushed event (founder decision 3 above).

- [ ] **Step 1: Write the runbook**

Follow the structure of `docs/infra/portal-go-live-runbook.md` — a fill-in-your-values block first, then numbered steps each with a **verify** command. Cover:

1. **IAM role for MediaConvert** (the role the MediaConvert *service* assumes to run a job). Trust policy for `mediaconvert.amazonaws.com`. Permissions: `s3:GetObject` on `arn:aws:s3:::$BUCKET/orgs/*/master/*` and `s3:PutObject` on `arn:aws:s3:::$BUCKET/orgs/*/screener/*`. **Not bucket-wide** — the spec requires read on masters and write on screeners only.
2. **Account-specific MediaConvert endpoint.** `aws mediaconvert describe-endpoints --query "Endpoints[0].Url" --output text`. This is per-account and per-region; the SDK needs it.
3. **No job template.** Encoding settings are submitted inline by `buildProxyJobSettings` (Task 3) so they live in version control and are unit-tested, rather than in console state nobody can diff. Say so explicitly in the runbook — otherwise someone will helpfully create one and the two will drift.
4. **The app's own MediaConvert read access.** The poll (Task 5) calls `GetJobCommand`/`ListJobsCommand` using the same `gc-assets-app` IAM user credentials `src/lib/mediaconvert.ts` and `src/lib/s3.ts` already use — not the role from bullet 1, which MediaConvert assumes, never the app. Add `mediaconvert:GetJob` and `mediaconvert:ListJobs` to that user's policy. Check what it already grants before adding anything: it already has `s3:GetObject` bucket-wide (`asset-storage-setup.md` / `portal-go-live-runbook.md` STEP 2), which already covers the `HeadObject` the poll performs on the screener prefix — don't duplicate it.
5. **Env vars** set locally and in Vercel: the three above, plus `CRON_SECRET` (Vercel sends this as a bearer token when it invokes a cron route — see Task 5). Note explicitly they are server-only and must never be `NEXT_PUBLIC_`.

- [ ] **Step 2: Write the verification section — this is the part that matters**

A green console does not mean a working pipeline. Each verify must prove *selection*, not existence:

- Submit one real job from the CLI against a known master key and confirm an output object appears at the expected prefix.
- **Confirm the app's IAM user can actually call `GetJob`/`ListJobs`** against that test job id — an `AccessDenied` here means the poll will run forever finding nothing, silently, which is exactly the "green console, no effect" failure this runbook exists to catch.
- **Confirm the proxy is NOT archive-tagged.** `aws s3api get-object-tagging` on the produced output must come back with no `gc-archive` tag. Masters are tagged at `CreateMultipartUpload` and the Glacier lifecycle rule selects on that tag, so a MediaConvert-written object is untagged and stays instant *by default* — but the whole point of this slice is a screener that never goes cold, and "correct by accident" is worth one command to confirm.
- State plainly that a permission grant which resolves to `implicitDeny` on the one action that matters looks identical, in the console, to one that works.

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

**Order matters:** submit first, then record. If the submit throws there is no job to record; if the record throws we log a job that exists in AWS but not in our table, which the poll in Task 5 is designed to find.

> **Note on the shipped code:** `src/app/api/assets/complete/route.ts`'s comment on this path currently reads "which Task 6's reconcile pass is designed to find and pick back up" — written when the callback design still had a separate reconcile task. That comment is now off by one task number and describes a "reconcile pass" that this replan folds into the poll itself; harmless but stale. Update it the next time this file is touched for an unrelated reason, rather than as a docs-only edit.

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

### Task 5: The scheduled poll

This is the highest-risk task in the plan. It is the only place completion gets discovered at
all, and it is the first scheduled job in this codebase — `docs/scheduled/subscription-lifecycle.md`
has no cron infrastructure to point to, so the cron declaration and the auth pattern built here
are what the subscription-lapse job will reuse. Get the shape right once.

**Files:**
- Create: `vercel.json`
- Create: `src/lib/transcode-poll.ts`
- Create: `src/lib/transcode-poll.test.ts`
- Create: `src/app/api/cron/transcode-poll/route.ts`
- Create: `src/app/api/cron/transcode-poll/route.test.ts`

**Interfaces:**
- Consumes: `register_transcode_output`, `fail_transcode_job` (Task 2); `@/lib/list-bounds`
- Produces: `resolveJobOutcome(status: "COMPLETE" | "ERROR" | "CANCELED" | string): "complete" | "failed" | null` — pure, unrecognised statuses (e.g. `PROGRESSING`) map to `null` and are left alone.

- [ ] **Step 1: Declare the cron in `vercel.json`**

This repo has no `vercel.json` today — this is the first entry in it. Keep the array shaped so
the lapse job can add its own entry beside this one rather than inventing a second scheduling
mechanism:

```json
{
  "crons": [
    { "path": "/api/cron/transcode-poll", "schedule": "*/5 * * * *" }
  ]
}
```

Every 5 minutes, not every 1: a transcode already takes minutes, so 5 is a small addition to that
— and it keeps `ListJobs`/`GetJob` call volume proportionate. Vercel Pro allows tighter, but there
is no product reason to poll faster than the latency it is bounding.

- [ ] **Step 2: Write the pure outcome mapper and its tests first**

```ts
import { describe, expect, it } from "vitest";
import { resolveJobOutcome } from "@/lib/transcode-poll";

describe("resolveJobOutcome", () => {
  it("maps MediaConvert's terminal states", () => {
    expect(resolveJobOutcome("COMPLETE")).toBe("complete");
    expect(resolveJobOutcome("ERROR")).toBe("failed");
    expect(resolveJobOutcome("CANCELED")).toBe("failed");
  });

  it("leaves non-terminal or unrecognised states alone", () => {
    expect(resolveJobOutcome("PROGRESSING")).toBeNull();
    expect(resolveJobOutcome("SUBMITTED")).toBeNull();
    expect(resolveJobOutcome("something-unexpected")).toBeNull();
  });
});
```

Implement `resolveJobOutcome` to satisfy it. Keep it a plain string mapping — no AWS SDK import,
no I/O — so the decision the route makes is unit-tested apart from the network calls that surround
it.

- [ ] **Step 3: Write the route**

In order, refusing at each step:

1. **Authenticate.** Vercel invokes cron routes with `Authorization: Bearer $CRON_SECRET`. Compare
   the header against `process.env.CRON_SECRET` with a timing-safe equality check (equal-length
   buffers, `crypto.timingSafeEqual` — a `!==` string compare leaks length and content via timing).
   Missing or wrong → **401**. **If `CRON_SECRET` is unset, refuse — never fail open** into a poll
   anyone can trigger by hitting the route with no header at all.
2. **Select in-flight jobs.** `transcode_jobs` rows with `status in ('submitted', 'running')`,
   bounded via `@/lib/list-bounds` (`probeRange`/`splitProbe`, the same pattern every other list
   read in this repo uses since `a092250`). Log a warning if the result was truncated — a poll
   that silently only ever sees the first page of a growing backlog is the same failure class as
   the truncation bug that pattern exists to catch.
3. **For each job, call `GetJobCommand`** against MediaConvert using the job's `external_job_id`.
4. **Resolve the outcome** with `resolveJobOutcome(job.Status)`. `null` (still in progress) → skip,
   leave the row alone.
5. **On `"failed"`:** call `fail_transcode_job`. Continue to the next job.
6. **On `"complete"`:** `HeadObject` the job's `expected_output_key` to obtain the real `bytes` and
   the ETag as `content_hash`. **If the object is absent, call `fail_transcode_job` with that
   reason instead — do not register an asset for something that is not there.** Otherwise call
   `register_transcode_output(jobId, expectedKey, bytes, contentHash)`.
7. **Idempotency across overlapping runs.** A poll can still be running when the next scheduled
   tick fires (a large in-flight batch, a slow AWS response). `register_transcode_output` and
   `fail_transcode_job` are both already idempotent on job id at the RPC layer (Task 2's row lock
   and status check) — the route does not need its own lock, but must not treat "job already
   `complete`" as an error when a concurrent run got there first. Log it as a no-op, not a failure.
8. **Stuck-jobs signal.** Among the jobs selected in step 2, count those with `created_at` older
   than a threshold (e.g. 60 minutes — comfortably longer than any real transcode plus several
   missed ticks) still `submitted`/`running` after this run. Log it at `warn` when non-zero
   (`[transcode:stuck] N job(s) older than 60m still in flight`) and include the count in the
   route's JSON response, so a health check or the GC panel (Task 6) can surface it rather than a
   client discovering a missing proxy first.

Never derive the output key, org, or title from anything MediaConvert returns beyond the job's
status — they come from the job row, exactly as the callback design required.

- [ ] **Step 4: Write the route tests, and mutation-check the authentication**

Assert: no header → 401 and **no MediaConvert call, no RPC called**; wrong header → 401 and
nothing called; unset `CRON_SECRET` → 401 even with a header present; valid header selects only
`submitted`/`running` jobs; `ERROR`/`CANCELED` → `fail_transcode_job`, no asset; `COMPLETE` with a
missing object → `fail_transcode_job`, no asset; `COMPLETE` with the object present →
`register_transcode_output` with the key **from the job row**; a job already `complete` when the
poll reaches it is a no-op, not an error; a job whose `created_at` is old enough contributes to the
stuck-jobs count and a fresh one does not; the selection query is bounded and a truncated result
logs a warning.

**Mutation-check:** delete the auth check, confirm the "no header" and "wrong header" tests fail,
restore, confirm green. Report the observed output — do not reason about it.

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build`

```bash
git add vercel.json src/lib/transcode-poll.ts src/lib/transcode-poll.test.ts src/app/api/cron/transcode-poll
git commit -m "feat(transcode): scheduled poll replaces the EventBridge callback"
```

---

### Task 6: GC visibility and retry

A failed transcode that nobody can see is the same as no pipeline.

> **Amended 2026-08-07 — execution only, scope unchanged.** Task 6 executes as two commits along
> the Step 1 / Step 2 boundary already written below: **6A** is Step 1 (the read-only panel) and
> **6B** is Step 2 (the retry mutation). Nothing is added, removed or deferred — 6B is the second
> half of this task, not a later slice, and the task is not done until both have shipped. The
> amendment exists only because Step 3 below originally said one commit; the two halves fail
> differently (6A is a bounded read, 6B submits to AWS and writes a row under a role gate) and
> reviewing them together is how the second one gets skimmed.
>
> **Status 2026-08-07:** Step 1 / 6A shipped and merged to `main` as PR #93
> (`0f4ed6360f45075d8becedd7efbb8f48f3a1cbc7`). Step 2 / 6B is the next implementation slice.
> 6B remains a separate mutation slice: no new schema expected unless implementation evidence
> proves otherwise; preserve existing authorization/RPC boundaries; do not retry completed jobs
> (partial unique index `transcode_jobs_active_key_uidx`); AWS submit and job-recording failure
> paths must be explicit and tested.

**Files:**
- Create: `src/app/(app)/(operator)/gc/titles/[id]/transcode-panel.tsx` *(6A — done)*
- Create: `src/lib/transcode-jobs.ts` *(6A — done; stuck/status/copy helpers)*
- Modify: `src/app/(app)/(operator)/gc/titles/[id]/page.tsx` *(6A — done; 6B may extend)*
- Modify: `src/app/(app)/(operator)/gc/titles/[id]/actions.ts` *(6B)*

- [x] **Step 1: Panel** — done (PR #93 / `0f4ed63`)

List the title's `transcode_jobs`: status, created, failure reason, and the resulting screener asset when complete. Bounded read via `@/lib/list-bounds`, inside the page's existing `Promise.all`. Design tokens only; reuse `Card`, `InlineNotice`, `Button`. Shipped with derived stuck state (active + strictly older than 60 minutes), no heartbeat, no retry.

- [ ] **Step 2: Retry action**

A server action that re-submits for the job's source asset and records a new job row. Gate on GC operate — the RPC already enforces it; the UI must not offer it to a role that would be refused.

- [ ] **Step 3: Verify and commit** *(6A committed; remaining is 6B)*

Run `pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build` before the 6B commit.

```bash
# 6A — Step 1 (SHIPPED — PR #93)
# git commit -m "feat(gc): add transcode job status panel"  → 0f4ed63

# 6B — Step 2
git add "src/app/(app)/(operator)/gc/titles/[id]"
git commit -m "feat(gc): retry a failed transcode"
```

---

### Task 7: The domain-spec amendment

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

### Task 8: The backfill runbook

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
