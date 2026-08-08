# Screener proxy backfill — founder runbook

**Status:** documentation only (Plan Task 8).  
**This document does not authorize spend.** It does not run jobs, apply migrations, or touch AWS.

**Companion AWS setup:** `docs/infra/screener-proxy-setup.md`  
**Design / decisions:** `docs/superpowers/specs/2026-08-06-screener-proxy-design.md`  
**Code paths:** `src/lib/mediaconvert.ts` (`submitProxyJob`), `src/lib/mediaconvert-settings.ts` (`proxyOutputKey`), `create_transcode_job` / `register_transcode_output` in `supabase/migrations/20260807000100_transcode_jobs.sql`, poll at `src/app/api/cron/transcode-poll/route.ts`, GC retry at `src/app/(app)/(operator)/gc/titles/[id]/actions.ts`.

---

## 1. Purpose and founder-only warning

Generate one browser-compatible H.264 screener proxy per eligible **current** master so buyer/GC viewing no longer depends on an unplayable or Glacier-bound master.

| Who | May |
|---|---|
| **Founder** | Apply prod migrations, apply AWS runbook, set Vercel envs, run canary / batches, spend MediaConvert money |
| **Agents / implementers** | Maintain this document and (later) a dry-run-capable script — **never** run migrations, `psql`, AWS CLI, or submit jobs |

**Nothing in this repo’s agent workflow may execute this backfill.**

Approximate catalogue prose (design/plan): ~700 masters × ~$1 ≈ ~$700 one-time. Treat as an order-of-magnitude estimate until a dry-run list is produced against production.

---

## 2. Prerequisite sequence (no circular canary gate)

### 2a. Preconditions BEFORE any fleet backfill (and before canary submit)

All of the following must be true **before** the one-master canary is submitted:

1. Production migrations applied and verified with **non-mutating** checks only (§3 / M1).
2. Production app deploy includes submit + poll + register code already on `main` (§4 / D1).
3. AWS / IAM / MediaConvert / Vercel env configured and **selection-verified** per `screener-proxy-setup.md` (§5 / A1), with **`s3:ListBucket` ordering satisfied** (§6).
4. Cron confirmed healthy enough to support the canary (§7 / C0).
5. Canary title/master selected (§8 / C1) — immediately readable current master (§11–12).
6. Eligibility + Glacier rules understood (§10–12).
7. Canary execution **approved by founder**, using only an authorized submission vehicle (§8 / §13).

### 2b. Controlled canary spend

Exactly **one** approved canary master may incur AWS / MediaConvert spend **before** C2 PASS.

The canary **is** the first controlled spend. Do **not** read this runbook as requiring zero AWS spend before canary PASS — that would be circular. Do **not** start pilot or fleet submission before C2 PASS.

### 2c. Preconditions BEFORE pilot / backfill batches

All of the following must be true before pilot or any further batch:

1. Canary **C2 PASS** recorded (§9).
2. No operational stop condition triggered (§17).
3. Founder explicitly approves moving to pilot.
4. The reviewed founder-run TypeScript bulk/pilot script exists, has been reviewed, validated, and founder-approved (§13). **Pilot/batch must not proceed without that script.**

---

## 3. Required production migrations

**Last documented evidence** (`docs/HANDOFF.md` / CI `migration-drift`): production was **7 migrations behind** `main`:

| Migration | Relevance |
|---|---|
| `20260806000100` … `20260806000500` | Buyer / screener-link surface |
| **`20260807000100_transcode_jobs.sql`** | **Hard requirement** — `transcode_jobs`, RLS, `create_transcode_job`, `register_transcode_output`, `fail_transcode_job`, `transcode_jobs_active_key_uidx` |
| `20260807000200_attach_link_vendor_default_null.sql` | Link RPC shape (documented gap; not MediaConvert-critical) |
| **`20260808000100_hide_gc_unnamed_screener_links.sql`** | **Required** — Option D layer B; do not ship `003` transparency without this |
| **`20260808000200_portal_resolve_screener_asset_kind.sql`** | **Required** — returns `asset_kind` so portal routes authorize the resolved asset (TOCTOU close) |

**M1 is BLOCKED** until Option D + TOCTOU remediation is merged to `main`. Do not apply the
buyer/transcode package to production while the unnamed-link bypass or stream TOCTOU would land.
Future apply package = original seven + `080001` + `080002` (**nine** migrations).

**REQUIRED production ordering (STOP condition):**

1. Merge Option D + TOCTOU app + `080001` + `080002` to `main`.
2. Deploy the **NEW** application code first.
3. Verify the deployed portal gate is fail-closed (no `asset_kind` → refuse; no master stream).
4. Fresh production drift/preflight.
5. Founder applies all **nine** migrations in timestamp order in one controlled package.
6. Non-mutating schema/RLS/function/type verification.
7. Only then D1/A1 — not C2.

**Do not begin the nine-migration production apply while the old application build is serving
traffic.** Applying `20260806000300` under the old app can expose GC unnamed tokens while the
old unnamed master-stream exemption still exists.

**Founder checkpoint M1 (non-mutating verification only — after the ordering above):**

1. Show exact SQL; get destructive-ops approval; founder applies to production (step 5 only after steps 1–4).
2. Confirm `migration-drift` (or equivalent) is **green** / migration presence is confirmed for the required set above.
3. Confirm `transcode_jobs` schema expectations without writing rows: table / RLS / RPC **definitions** present via metadata or migration verification; application-generated types / schema expectations match (`src/lib/supabase/database.types.ts` vs applied migrations).
4. Optional: an authenticated **read** path that proves operator visibility of `transcode_jobs` where repository rules already allow a non-mutating check (empty result set is fine).

**Do not** call `create_transcode_job` (or any other mutating RPC) merely to prove migrations exist. **Do not** create a production job row as a migration smoke test. First production job creation belongs to the authorized canary (§8), not M1.

**This runbook does not apply migrations.** Agents must not run `supabase db push`, `psql`, or MCP apply against production.

---

## 4. Required Vercel / app deployment state

Production (and any environment used for canary) must already serve:

- Master-upload submit path: `submitProxyJob` + `create_transcode_job` (`src/app/api/assets/complete/route.ts`)
- Poll: `GET /api/cron/transcode-poll` + `vercel.json` cron
- GC panel + retry (Tasks 6A/6B)
- Corroboration / permanent-fail logic that makes ListBucket safe (`432ecbb` lineage)

**Founder checkpoint D1:** confirm production deployment revision includes that code **before** granting `s3:ListBucket` in production IAM.

Server-only env (never `NEXT_PUBLIC_`):

- `MEDIACONVERT_ENDPOINT`
- `MEDIACONVERT_ROLE_ARN`
- `MEDIACONVERT_QUEUE_ARN`
- `CRON_SECRET`
- Existing `S3_BUCKET` / `AWS_REGION` (and app IAM credentials)

---

## 5. Required AWS / IAM / MediaConvert configuration

Follow **`docs/infra/screener-proxy-setup.md`** for **infrastructure setup and non-submitting verification** only. Every verify step must prove **selection**, not mere resource existence.

Use the setup runbook for:

- MediaConvert role (`gc-mediaconvert-role`) and scoped GetObject / PutObject
- Queue + account MediaConvert endpoint
- App IAM permissions (`CreateJob`, `GetJob`, conditioned `PassRole`, and — only after §6 — `s3:ListBucket`)
- Vercel env (`MEDIACONVERT_*`, `CRON_SECRET`)
- Non-submitting checks (`simulate-principal-policy`, resource presence/selection proofs, env leak checks, ListBucket ordering commentary)

**Task 8 / A1 — skip the setup runbook’s legacy manual AWS CLI MediaConvert job submission** (its “End-to-end verification” `create-job` paste). That step is **not** the approved production end-to-end validation path for this workflow. Do **not** substitute an AWS console job either.

**Actual end-to-end MediaConvert + app validation for Task 8 is the governed C2 one-master canary** in this document (§8–§9): authorized vehicle → `submitProxyJob` → `create_transcode_job` → poll → GC panel **and** buyer gated playback.

Minimum A1 outcomes (infra / non-submitting):

- `gc-mediaconvert-role` can GetObject masters and PutObject screeners (scoped keys)
- Account MediaConvert endpoint + queue ARNs
- `gc-assets-app` holds `mediaconvert:CreateJob`, `GetJob`, `iam:PassRole` (conditioned), and (only after §6) `s3:ListBucket` on the **bucket** ARN
- Vercel production env populated for the four vars in §4

**Founder checkpoint A1:** record evidence that the **setup** runbook’s infrastructure + non-submitting verifies were applied (or re-verified) in the GC AWS account. Repository history alone does **not** prove it. A1 does **not** require or authorize the legacy CLI `create-job`; C2 covers end-to-end.

---

## 6. `s3:ListBucket` ordering constraint

**Do not grant production `s3:ListBucket` before the poll code in §4 is live.**

| Without ListBucket | With ListBucket |
|---|---|
| Missing object → HeadObject **403** → poll retries (stuck, not permanent) | Missing object → **404** → poll may **permanently fail** the job |

Permanent fail is irreversible under “nothing is deleted”; recovery needs a **new** job row. A systemic key/bucket fault plus ListBucket can fail an in-flight fleet in one poll tick. The corroboration gate exists so the grant is usable — only after that code is deployed.

See also HANDOFF “One ordering constraint that can cause permanent data loss” and the setup runbook STEP 4 commentary.

---

## 7. Cron-health verification

Before canary:

1. Confirm Vercel cron invokes `GET /api/cron/transcode-poll` on the configured schedule.
2. Confirm requests present `CRON_SECRET` as required by the route.
3. After canary submit: job row must leave `submitted` within a small number of intervals (MediaConvert runtime + one poll), or stuck-marker / logs explain why.

**No heartbeat table exists** (accepted residual). Cron silence and MediaConvert stall look similar in the panel (aging active rows). If nothing advances, **STOP submits** — do not “push through” with more jobs.

---

## 8. One-master canary procedure

**Do not select or execute the canary in this Task 8 docs slice.**

### 8a. Authorized submission vehicles (precise)

| Vehicle | Status for Task 8 | May use for |
|---|---|---|
| Founder-run TypeScript backfill script (§13) | **Does not exist yet** | Pilot + controlled batches (required); may also run canary once reviewed |
| `POST /api/assets/complete` after a real master multipart upload completes (`src/app/api/assets/complete/route.ts`) | Existing reviewed production path | **One-master canary only**, if the canary is that completed upload’s current master and the path still performs `submitProxyJob` → `create_transcode_job` without new unreviewed code |
| `retryTranscodeJob` (GC panel) | Existing reviewed path | **Not** a virgin canary — only `failed` / `submit_failed` after a prior job |
| Ad hoc MediaConvert console / raw one-off / “temporary operate RPC” | **Forbidden** | Never |

**There is no reviewed production path today that submits a first-time proxy for an already-stored master without going through master-upload completion or the future script.** If the founder needs a canary against a pre-existing master **without** a new upload-complete event, canary execution is **blocked** until the §13 script is implemented, reviewed, validated, and founder-approved — or until the founder chooses the upload-complete canary vehicle above.

Having `gc_can(operate)` does **not** authorize any undefined interim path.

### 8b. Canary steps (when founder is ready)

1. Preconditions §2a satisfied (M1, D1, A1, ListBucket order, C0, C1, founder canary approval).
2. Choose **one** title whose **current master** (§11) is immediately readable (not Glacier / not unrestored) (§12).
3. Confirm no `transcode_jobs` row in (`submitted`,`running`,`complete`) for that master’s deterministic screener key (§10).
4. Submit using **only** an authorized vehicle in §8a — always `submitProxyJob` then `create_transcode_job` with org/title/source/expected key/external id from trusted state. **Never** an ad hoc MediaConvert console job.
5. Observe GC title **Proxy jobs** panel + `transcode_jobs` + poll.
6. Verify registration, `screener_source` flip rule, **GC panel state**, and **buyer portal playback** (§9). Both GC and buyer checks are mandatory for C2.

This single canary is the first controlled AWS spend. C2 PASS is required before pilot — not before this canary itself.

---

## 9. Canary PASS / FAIL criteria

### PASS (C2) — all required; buyer playback is mandatory

C2 does **not** pass unless **both** operator and buyer verification succeed.

**Pipeline / object / DB**

- MediaConvert job reaches terminal success with object at the **recorded** `expected_output_key`
- Job row: `submitted`/`running` → `complete`; `output_asset_id` set
- New `assets` row `kind = 'screener'` at that key
- `screener_source`: if was `'master'`, flipped to `'dedicated'`; if was already `'dedicated'`, **unchanged**
- No permanent fail from false absence; no unexpected mass deferral
- Spend / side effects attributable only to the intended canary master

**GC operator verification (required)**

- Job visible and correct in the GC title **Proxy jobs** panel
- Resulting screener state on the title is consistent with registration / `screener_source` rules above

**Buyer portal verification (required — not optional)**

- Playback through the **actual gated buyer viewing path** (portal / buyer screener surface that resolves via `portal_resolve_screener` / the shipped buyer title page), not a substitute signed URL outside that gate
- Proxy plays end-to-end for the buyer session
- Master-download licensing boundary remains intact (buyer can view the screener path without gaining unauthorized master download)

If buyer playback **cannot** be verified, **C2 does not pass** and pilot/backfill must not start.

### FAIL — any

- AccessDenied on CreateJob / PassRole / GetObject / PutObject
- Complete-but-missing object / wrong key → permanent fail or endless retry
- RPC missing / unexpected unique conflict on a clean first canary
- `screener_source` flipped despite explicit `'dedicated'`
- Cron never advances the row
- GC panel incorrect / missing job or screener state
- Buyer gated playback fails, is skipped, or is substituted with a non-portal check
- Master-download licensing boundary broken
- Spend or side effects not attributable to the intended master

**On FAIL: STOP.** No pilot. No fleet. No invented AWS cleanup. Diagnose; use GC Retry only for `failed` / `submit_failed` after root cause — Retry is not a substitute C2 gate.

---

## 10. Eligibility rules

Include a title’s **current master** (§11) when **all** of:

1. Asset `kind = 'master'` and is the current master for its title (§11).
2. `storage_key` present and valid for `proxyOutputKey` / `submitProxyJob`.
3. Master is immediately readable — **not** archived Glacier / unrestored (§12).
4. No existing `transcode_jobs` row for the deterministic screener output key of that master with `status in ('submitted','running','complete')` (partial unique index `transcode_jobs_active_key_uidx`).

**Explicitly allowed:**

- Titles with `screener_source = 'dedicated'` — still eligible for proxy **generation/registration**. The flip rule must **never** override that selection (`register_transcode_output` only flips when current value is `'master'`).

**Exclude from the initial cohort:**

- Historical (non-current) master assets (§11)
- Glacier / unrestored masters (§12) — deferred cohort
- Masters whose key already has an active or complete job
- Invalid / non-master / missing-key rows

Failed / `submit_failed` jobs **release** the key and may be retried later via GC Retry or a controlled re-run of eligible failures only — not by mutating old rows.

---

## 11. Current-master selection rule (repository evidence)

**Rule:** For each title, the current/canonical master is the single `assets` row with:

```text
kind = 'master'
ORDER BY created_at DESC
LIMIT 1
```

**Evidence (do not substitute a different heuristic):**

- `portal_resolve_screener` in `supabase/migrations/20260720000300_screener_room.sql` resolves the master screener source with exactly that predicate when `screener_source = 'master'`.
- `20260807000100_transcode_jobs.sql` documents the same resolution: *“portal_resolve_screener resolves the latest by title (`order by created_at desc limit 1`)”*.

There is **no** separate `is_current` / `canonical` column. Newest `created_at` among `kind = 'master'` **is** the product’s current master.

Backfill selects **that row only** per title that has at least one master. Older master rows on the same title are **out of scope** for Task 8.

---

## 12. Glacier exclusion / deferred cohort

**Initial canary and initial backfill batches: immediately readable masters only.**

- Do **not** automatically restore Glacier objects as part of Task 8.
- Storage class is **not** stored in Postgres (`assets` has no storage-class column). Readability must be verified via S3 (e.g. HeadObject storage class / restore status) before include.
- Exclude: `GLACIER`, `DEEP_ARCHIVE`, and any object pending restore / not yet restored to a readable class.

**Deferred cohort (separate founder-approved procedure later):**

- List current masters that are archived / unrestored
- Restore strategy, restore cost, MediaConvert timing after restore
- Own canary + batching + stop conditions
- Not authorized by this runbook’s initial cohort

---

## 13. Submission mechanism governance

### 13a. Bulk / pilot vehicle (required; not yet built)

**Intended bulk and pilot execution vehicle:** a founder-run TypeScript script in this repository.

That script **does not exist yet.** It must **not** be treated as authorized merely because an operator has `operate`.

**No pilot or batch execution may proceed** until that script is separately implemented, reviewed, validated, and founder-approved.

When written, the script **must**:

- Support **dry-run / list-only** mode (default or required flag)
- Select only approved eligible current masters (§10–12)
- Accept explicit **batch-size** and **concurrency** controls
- Derive org / title / source asset / `storage_key` / expected key from DB + `proxyOutputKey` — never from ad hoc CLI key paste
- Reuse `submitProxyJob`
- Reuse `create_transcode_job`
- Preserve **submit → record** ordering
- Preserve immutable job history (new rows only; no update/delete of old jobs)
- Stop on operational thresholds (§17)
- Emit an auditable summary: selected / submitted / skipped (reason) / failed

### 13b. Canary-only existing path

See §8a. The only reviewed first-submit production path today is master-upload completion via `POST /api/assets/complete`. It may be used for the **one-master canary** only under §8a. It is **not** authorization for pilot/fleet, ad hoc console jobs, or inventing a temporary operate-gated substitute.

### 13c. Forbidden mechanisms

- MediaConvert console jobs (including “just one” with hand-picked settings)
- Raw one-offs that bypass `submitProxyJob` → `create_transcode_job`
- Any undefined / interim / “temporary” path justified only by operate capability
- Compensating deletes; agent-run execution
- Pilot/batch submits before the §13a script is reviewed and founder-approved

---

## 14. Dry-run requirement

Before any submitting **pilot or batch** (after C2):

1. Run list-only / dry-run of the §13a script against production (founder).
2. Review counts: eligible, Glacier-deferred, already-complete/active, invalid.
3. Confirm spend estimate ≈ eligible × ~$1 (order of magnitude).
4. Confirm canary title/master is accounted for (already complete / skipped) so it is not double-submitted.

No dry-run → no pilot/batch submit. (The one-master canary itself is gated by §2a / §8, not by the bulk dry-run.)

---

## 15. Canary → pilot → controlled-batch rollout

Approved sequence:

| Stage | Size | Gate |
|---|---|---|
| Canary | **1** real master (§8a vehicle) | §2a preconditions; then §9 **C2 PASS** (GC **and** buyer) |
| Pilot | **5–10** | C2 PASS; no stop condition; founder approves pilot; **§13a script** reviewed + approved; dry-run (§14) |
| Controlled batches | Sized from observed MediaConvert runtime, poll throughput, failure rate, spend | Prior batch clear; same script + dry-run discipline |

**No full-catalogue single wave.**  
**No pilot/fleet before C2 PASS.**  
**No pilot/fleet before the §13a script exists and is founder-approved.**

After pilot, batch size is an operational judgment from real timings — not a fixed magic number in this doc.

---

## 16. Cost / spend monitoring

- Track MediaConvert job count and AWS cost per batch
- Compare to dry-run eligible count × ~$1
- Stop if spend materially exceeds expectation for the batch size
- Glacier restore costs are **out of scope** for the initial cohort (deferred cohort only)

---

## 17. Operational stop conditions

Stop **new** submits (let in-flight finish or fail visibly) if:

| Signal | Notes |
|---|---|
| Unexpected 403/404 / ListBucket suspicion | Verify IAM + deploy order |
| Systemic output-key mismatch / mass permanent fails | Do not bulk retry |
| Repeated CreateJob / PassRole / GetObject denials | Fix IAM/env |
| Mass poll deferral / write-budget exhaustion / allErrored-style health failure | Drain; fix poll |
| Split-brain (AWS ok, record fails) | §18 |
| Unexpected `screener_source` flip on `dedicated` | P0 — stop |
| Duplicate / unique conflicts exploding | Inspect active rows |
| Spend ≫ batch expectation | Stop |
| Cron silent / nothing advances | Stop submits |

---

## 18. Split-brain / orphan-job handling

Architecture (upload path and retry): **AWS submit before DB record**. If AWS accepts and `create_transcode_job` fails:

- Surface / treat as: job submitted but not recorded — **do not retry yet; contact engineering**
- Poll **cannot** discover orphans (it only reads `transcode_jobs` rows)
- **No** compensation, AWS cancel automation, or cleanup invented here
- Concurrent cross-tab retries may double-submit before the unique index claims the key (founder-accepted residual from Task 6B)

---

## 19. Retry rules

| Status | Retry? |
|---|---|
| `failed`, `submit_failed` | Yes — GC Retry / controlled re-run (new row; same eligibility) |
| `submitted`, `running`, `complete` | **Never** |

Server re-checks eligibility; UI is affordance only. Pre-AWS `gc_can(operate)` + RPC write gate apply to GC Retry.

---

## 20. Explicit prohibited actions

- Agent-run migrations, `psql`, Supabase production applies, AWS CLI from agents
- Mutating M1 smokes (`create_transcode_job` or any job-row create as “migration proof”)
- Granting prod `s3:ListBucket` before poll code is deployed
- Auto-restoring Glacier as part of this initial backfill
- Backfilling non-current / historical masters
- Ad hoc MediaConvert console jobs
- Undefined / interim / temporary operate-gated submission paths
- Pilot or batch submits before the §13a script is implemented, reviewed, validated, and founder-approved
- Mutating or deleting old `transcode_jobs` / assets rows for “cleanup”
- Overriding `screener_source = dedicated`
- Full-catalog one-shot submit
- Treating GC-only verification as C2 PASS (buyer playback skipped)
- Claiming production validation or founder execution complete without a recorded **C2** (GC + buyer)
- Inventing compensation for orphans

---

## 21. Post-batch verification checklist

After each batch:

- [ ] Job counts: submitted / complete / failed match auditable summary
- [ ] Sample GC panel rows look correct (status, output, no bogus Stuck on fresh jobs)
- [ ] Spot-check **buyer** gated playback (not GC-only)
- [ ] Spot-check `screener_source` flip rule on `master` vs `dedicated` titles
- [ ] Spot-check master-download licensing boundary still holds
- [ ] No mass permanent fails / no unexplained unique conflicts
- [ ] Spend within batch expectation
- [ ] Poll still healthy before next batch

---

## 22. Remaining open residuals (not closed by this runbook)

- Production migration drift until founder applies (§3)
- Real-AWS validation until **C2** (GC + buyer) PASS
- Canary blocked for pre-existing masters without upload-complete unless §13a script ships (§8a)
- `s3:ListBucket` ordering discipline
- Heartbeat / cron invisibility debt
- Poll Supabase timeout gap
- Concurrent retry residual (Task 6B)
- Unnamed-link security finding (unrelated defer)
- `revoke_portal_link` status-gate (unrelated defer)
- Glacier deferred cohort (separate procedure)
- Founder-run TypeScript script not yet implemented (§13a) — **blocks pilot/batch**

---

## 23. Founder sign-off checkpoints

| ID | Checkpoint | Before |
|---|---|---|
| **M1** | Prod migrations applied + **non-mutating** verified (§3) | Canary submit |
| **D1** | Prod deploy includes poll/submit/register | ListBucket grant / canary submit |
| **A1** | AWS runbook + Vercel envs verified | Canary submit |
| **C0** | Cron healthy enough for canary | Canary submit |
| **C1** | Canary title/master chosen + founder approves canary vehicle (§8a) | Canary submit (first controlled spend) |
| **C2** | Canary **PASS** — GC panel **and** buyer gated playback (§9) | Pilot |
| **S1** | §13a TypeScript script implemented, reviewed, validated, founder-approved | Pilot / any batch |
| **P1** | Dry-run list reviewed (§14) | Pilot / each wave |
| **P2** | Pilot 5–10 clear; founder approves next | Controlled batches |
| **B1** | Each batch clear + checklist (§21) | Next batch |
| **G1** | Separate approval for Glacier cohort | Any Glacier restore/backfill |

**Plan Task 8 (this document) ≠ founder execution complete.**  
**Pipeline is not production-validated until C2 (including mandatory buyer playback).**  
**Pilot/backfill is not authorized until C2 + S1.**
