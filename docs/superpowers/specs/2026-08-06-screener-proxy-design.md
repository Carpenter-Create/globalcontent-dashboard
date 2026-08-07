# Screener proxy (transcoding) — design

**Date:** 2026-08-06
**Status:** approved in principle by the founder; two defaults marked **CONFIRM** below
**Depends on:** `feat/buyer-title-page` (merged or merging)
**Amended 2026-08-07:** the EventBridge push callback in the original §5–§7 is replaced by a
scheduled poll. See the amendment note at the top of §5 for the decision and its accepted costs.

---

## 1. Why

`titles.screener_source` defaults to `'master'`. On that default the screener **is** the master —
the same S3 object, byte for byte. Three consequences, all of which currently bite:

- **A master is not watchable.** It is commonly ProRes or DNxHD in a `.mov`; no browser plays it.
- **A master archives.** Glacier Flexible at 90 days, 3–5h to restore.
- **A master must not be handed over.** The buyer page therefore refuses both the screener stream
  and the screener download on a buyer link (`buyerActionsFor`, and `/api/portal/screener`).

So on every title today a buyer sees a poster, a synopsis and a metadata download, and nothing
playable. **The buyer title page is built and correct and does not yet do its job.** This slice is
what makes it work.

It also removes the reason clients were being asked to produce and upload a second file by hand —
an ask that was never going to hold.

## 2. What it does

On completion of a **master** upload, generate one small, web-playable **screener proxy** and
register it as a `screener` asset. Nothing else changes: the master still archives at 90 days, the
buyer still cannot download the master without a licence, and GC still never re-encodes anything
that is delivered to a vendor.

| | Master | Screener proxy |
| --- | --- | --- |
| Produced by | the client | this pipeline |
| Format | whatever they deliver | H.264 / AAC in MP4 |
| Size (100 min) | 50–500 GB | ~2 GB |
| Storage | Glacier at 90 days | stays instant, forever |
| Who may have it | licensed buyer only | any gated buyer |

## 3. The spec conflict — read before implementing

`docs/domain-spec.md` §12 states: *"Clients deliver platform-ready materials. GC runs no
transcoding pipeline."* `CLAUDE.md` repeats it on the do-not-build list.

**This slice contradicts that, and the amendment is part of the work, not a follow-up.**

The amendment must be narrow. §12's concern is that GC will not re-encode **deliverables** — most
premium vendors want a mezzanine master and encode themselves, and taking on that job means owning
every vendor's technical spec. That intent survives untouched. What changes is that GC generates an
**internal viewing proxy** that is never delivered to anyone as a deliverable.

Wording to add under §12, subject to founder edit:

> **Exception — internal viewing proxies.** GC generates one low-bitrate screener proxy per master,
> for viewing and evaluation only. It is never delivered to a vendor and never satisfies a delivery
> requirement. This is not a transcoding pipeline in the sense above: GC still does not re-encode
> deliverables, and clients still deliver platform-ready masters.

## 4. Decisions

| Question | Decision |
| --- | --- |
| Service | AWS Elemental MediaConvert. |
| Trigger | Master upload completion. |
| Output | H.264 1080p, ~2.5 Mbps VBR, AAC 128k, MP4, faststart. |
| Asset kind | `screener` — the kind already exists. |
| Cost | ~$1 per feature, one time. |

**CONFIRM 1 — a generated proxy flips `screener_source` to `dedicated`, but only from the default.**
Otherwise every title still needs a manual toggle and the page stays dark. The flip must never
override an explicit client choice: apply it only when the value is still `'master'`. If a client
has deliberately selected `dedicated` and uploaded their own screener, the generated proxy is
registered but the setting is left alone.

**CONFIRM 2 — backfill all existing masters in one pass.** ~700 titles, ~$700 one-time. The
alternative — transcode on first buyer access — spreads the cost but means the first buyer to open
an older title waits hours. A catalogue where some titles work is a worse product than either
extreme. **The backfill is a runbook the founder executes; this slice never spends money on its
own.**

## 5. Architecture

**Amendment — 2026-08-07: poll, not push.** The design below originally had MediaConvert push a
completion event through EventBridge to an API destination with a shared secret, landing on a
public `POST /api/transcode/callback` that registered the resulting asset. **The founder has
chosen polling instead:** a scheduled job asks MediaConvert about in-flight jobs and registers the
finished ones. Vercel Pro is confirmed, so minute-level cron is available. In the founder's
priority order:

1. **It removes a public write endpoint.** That endpoint would have registered an asset the
   buyer-facing page then serves — the highest-risk component in the whole slice. Polling has no
   inbound surface: nothing to authenticate, no forged events, no shared secret to leak, rotate,
   or mis-scope.
2. **It removes about half the AWS setup** — the EventBridge rule, the API destination, the
   connection, the invoke role and its confused-deputy trust condition, and the callback secret.
   This repo has already shipped an AWS configuration that showed green in the console and
   selected zero objects (the lifecycle-tag defect logged in
   `docs/infra/portal-go-live-runbook.md` STEP 1); every config not written is one that cannot do
   that.
3. **It is one mechanism, not two that must agree.** The push design still needed a reconcile job
   for lost events — so it cost an endpoint *and* a scheduler. Polling **is** the reconcile; there
   is no second mechanism that has to agree with the first.
4. **It is testable.** An EventBridge callback cannot readily be received on localhost; a poll
   runs locally against real AWS.

**Accepted costs — written down, not glossed:**
- A proxy appears within a poll interval rather than seconds after AWS finishes. The transcode
  itself takes minutes, so the marginal delay is small — but real.
- Progress depends on the scheduler running. If cron stops, nothing advances, and it fails
  quietly — hence the stuck-jobs signal in §5's table and §6's row for it. This exposure existed
  in the push design too, via its reconcile job; polling does not introduce it, it just remains
  the only place the exposure lives.
- **There is no cron infrastructure in this repo today** — no `vercel.json`, no `vercel.ts`, no
  scheduled functions. `docs/scheduled/subscription-lifecycle.md` says so already, and notes that
  the subscription-lapse job will need one too. This slice therefore introduces the **first**
  scheduled job in the codebase, and must do so in a way the lapse job can reuse — not a
  one-off wired just for this pipeline.

```
complete master upload
  → submit MediaConvert job (input = master key, output = screener prefix)
  → job runs (minutes)
  → scheduled poll asks MediaConvert about jobs still in flight
  → poll writes the screener asset row, flips screener_source if still default
```

| Piece | Responsibility |
| --- | --- |
| `src/lib/mediaconvert.ts` | Submit a job. Pure input→job-settings mapping kept separate and unit-tested. |
| `src/app/api/assets/complete/route.ts` | On `kind === 'master'`, submit. Best-effort: **a submit failure must not fail the upload** — the master is already in S3 and the client's work must not be lost. |
| `transcode_jobs` table | One row per job: title, source asset, job id, status, timestamps, failure reason. This is the provenance record and the retry surface. |
| `GET /api/cron/transcode-poll` (new) | The scheduled poll. Invocable only by Vercel's cron dispatcher — see §7. Selects in-flight jobs (bounded), asks MediaConvert about each, writes the `screener` asset, updates the job row, conditionally flips `screener_source`, and surfaces a stuck-jobs count. |
| GC operator surface | Job status per title; a retry for failures. Without this a failed transcode is invisible. |

**Why a table rather than inferring from the asset's existence:** a failed or in-flight job is a
state the product must show. "No screener asset" cannot distinguish *not started*, *running*,
*failed*, and *the client chose their own*. The buyer page and the GC queue both need that
difference.

## 6. Failure behaviour

| Case | Behaviour |
| --- | --- |
| Job submit fails | Upload still succeeds. Job row `submit_failed`. Retryable from the GC surface. |
| Job fails (bad input, unsupported codec) | Job row `failed` with the reason. Title behaves exactly as today — buyer sees the "no viewable screener" notice. **No regression, only a missing improvement.** |
| The poll has not run yet | Job row stays `submitted`/`running` until the next scheduled tick. This is not a failure — it is the normal, expected state between AWS finishing and the poll noticing. The marginal wait is bounded by the cron interval. |
| The scheduler stops | Nothing advances, for every in-flight job at once, and it fails quietly — no error, just jobs that never leave `running`. The poll route must count jobs stuck past a threshold and expose that count (log line at minimum; a GC-visible signal is better) so a stalled cron shows up rather than being discovered by a client asking why their screener never appeared. This exposure existed in the push design too, via its own reconcile job — polling does not add it, it is simply now the only mechanism, so its health is the whole pipeline's health. |
| Overlapping poll runs (a slow run still in flight when the next tick fires) | Idempotent on job id — never register two screener assets for one job. A run that reaches a job already `complete` (because a previous, slower run finished it first) treats that as a no-op, not an error. |
| Client uploads their own screener first | Generated proxy is still registered; `screener_source` is left at their choice. |
| Master replaced by a re-upload | New job, new proxy. The old screener asset is superseded, not deleted (nothing is ever deleted). |

## 7. Security

The callback endpoint does not exist under this design. Removing it removes what most of this
section used to protect: no public write endpoint, nothing to authenticate, no forged events, no
shared secret to leak, rotate, or mis-scope. What remains is smaller and worth stating plainly:

- **The cron route is the surface.** `GET /api/cron/transcode-poll` is invoked on a schedule by
  Vercel, not by AWS and not by a browser. It must verify the bearer secret Vercel sends against
  its own env var, timing-safely, and **refuse (401) if that env var is unset — never fail open**
  into an unauthenticated trigger. There is no request body to distrust; there is only the
  question of who is allowed to start a run.
- **Output keys are still server-derived**, exactly as before: from `expected_output_key` on the
  job row, written at submit time via the same `assetKey()` scheme, never from anything MediaConvert
  returns beyond a job's status. A `HeadObject` on that recorded key supplies the real
  `bytes`/`content_hash` used to register the asset — MediaConvert's response cannot cause an
  asset to be registered at a key it wasn't asked to write to, and an absent object fails the job
  rather than registering an asset for something that isn't there.
- **The proxy carries no archive tag** — it must stay instantly available. Only masters are tagged
  (`ARCHIVE_TAG_KEY`, set at `CreateMultipartUpload`).
- **The MediaConvert IAM role** — assumed by the MediaConvert *service* to run the job, unchanged
  from the original design — **gets read on the master prefix and write on the screener prefix
  only.** Not bucket-wide.
- **The app's own IAM identity** (`gc-assets-app`, the same credentials `src/lib/mediaconvert.ts`
  and `src/lib/s3.ts` already use) needs `mediaconvert:GetJob` and `mediaconvert:ListJobs` added —
  nothing broader. `s3:GetObject`, already granted bucket-wide on that user, already covers the
  `HeadObject` the poll performs; see `docs/infra/screener-proxy-setup.md`.
- **No watermarking.** The proxy is still an untraceable copy once downloaded — that tradeoff was
  accepted for the buyer page and does not change here. Provenance remains the mitigation.

## 8. Testing

| Layer | Coverage |
| --- | --- |
| Vitest | Job-settings mapping; output key derivation; the `screener_source` flip rule **including that it never overrides an explicit `dedicated`**; poll idempotency across overlapping runs. |
| Vitest | Cron-route authentication — a missing or wrong bearer secret must be refused, and must not run the poll; an unset env var must refuse rather than fail open. Mutation-check this one. |
| pgTAP | `transcode_jobs` RLS; the asset write path; that a failed job leaves no screener asset. |
| Manual | One real master through the real pipeline, end to end, before the backfill. |

**The manual run is not optional.** This branch has now had three separate cases where code passed
review and failed on first execution. A pipeline that touches AWS and S3 will not be correct on
reading alone.

## 9. Sequencing

1. Infrastructure runbook — MediaConvert IAM role, account endpoint, output prefix, and the app's
   own `mediaconvert:GetJob`/`ListJobs` grant for the poll. No EventBridge, no API destination, no
   callback secret. Founder applies; this repo's runbooks have shipped a rule that matched zero
   objects before, so it needs a verification step that proves selection, not just that the
   resource exists.
2. `transcode_jobs` migration.
3. Submit on master completion.
4. The scheduled poll — cron declaration, authenticated route, bounded job selection, asset
   registration and conditional flip, stuck-jobs signal. This is the first scheduled job in the
   codebase; the mechanism it introduces is meant to be reused by the subscription-lapse job
   (`docs/scheduled/subscription-lifecycle.md`), not a one-off wired just for this pipeline.
5. GC visibility and retry.
6. One real title, manually verified.
7. Backfill runbook — founder executes.

## 10. Out of scope

- Multiple renditions or adaptive bitrate. One proxy.
- Watermarking or DRM.
- Re-encoding anything delivered to a vendor. §12's actual rule, unchanged.
- Captions/subtitle burn-in.
- Trailer or artwork processing — clients supply those and they are already instant.
