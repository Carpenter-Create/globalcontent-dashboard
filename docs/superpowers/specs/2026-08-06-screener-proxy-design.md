# Screener proxy (transcoding) — design

**Date:** 2026-08-06
**Status:** approved in principle by the founder; two defaults marked **CONFIRM** below
**Depends on:** `feat/buyer-title-page` (merged or merging)

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

```
complete master upload
  → submit MediaConvert job (input = master key, output = screener prefix)
  → job runs (minutes)
  → MediaConvert emits COMPLETE / ERROR on EventBridge
  → webhook/handler writes the screener asset row, flips screener_source if still default
```

| Piece | Responsibility |
| --- | --- |
| `src/lib/mediaconvert.ts` (new) | Submit a job. Pure input→job-settings mapping kept separate and unit-tested. |
| `src/app/api/assets/complete/route.ts` | On `kind === 'master'`, submit. Best-effort: **a submit failure must not fail the upload** — the master is already in S3 and the client's work must not be lost. |
| `transcode_jobs` table (new) | One row per job: title, source asset, job id, status, timestamps, failure reason. This is the provenance record and the retry surface. |
| `POST /api/transcode/callback` (new) | Receives job completion. **Must authenticate** — see §7. Writes the `screener` asset, updates the job row, conditionally flips `screener_source`. |
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
| Callback never arrives | Job row stays `running`. A reconcile pass queries MediaConvert for stale jobs. Without this, a lost event means a title silently never gets a proxy. |
| Duplicate callback | Idempotent on job id — never register two screener assets for one job. |
| Client uploads their own screener first | Generated proxy is still registered; `screener_source` is left at their choice. |
| Master replaced by a re-upload | New job, new proxy. The old screener asset is superseded, not deleted (nothing is ever deleted). |

## 7. Security

- **The callback endpoint is the attack surface.** It is public and it writes an asset row that the
  buyer page will serve. It must verify the event genuinely came from AWS — EventBridge to an
  authenticated internal route, or signature verification — and must derive the title and asset
  from the **job record**, never from the request body. An unauthenticated callback that trusts its
  payload lets anyone register an arbitrary S3 key as a screener on any title.
- **Output keys must be server-derived** from the same `assetKey()` scheme, never from the event.
- **The proxy carries no archive tag** — it must stay instantly available. Only masters are tagged
  (`ARCHIVE_TAG_KEY`, set at `CreateMultipartUpload`).
- **The MediaConvert IAM role gets read on the master prefix and write on the screener prefix only.**
  Not bucket-wide.
- **No watermarking.** The proxy is still an untraceable copy once downloaded — that tradeoff was
  accepted for the buyer page and does not change here. Provenance remains the mitigation.

## 8. Testing

| Layer | Coverage |
| --- | --- |
| Vitest | Job-settings mapping; output key derivation; the `screener_source` flip rule **including that it never overrides an explicit `dedicated`**; callback idempotency. |
| Vitest | Callback authentication — an unsigned or forged event must be refused, and must not write an asset. Mutation-check this one. |
| pgTAP | `transcode_jobs` RLS; the asset write path; that a failed job leaves no screener asset. |
| Manual | One real master through the real pipeline, end to end, before the backfill. |

**The manual run is not optional.** This branch has now had three separate cases where code passed
review and failed on first execution. A pipeline that touches AWS, EventBridge and S3 will not be
correct on reading alone.

## 9. Sequencing

1. Infrastructure runbook — MediaConvert template, IAM role, EventBridge rule, output prefix.
   Founder applies; this repo's runbooks have shipped a rule that matched zero objects before, so
   it needs a verification step that proves selection, not just that the resource exists.
2. `transcode_jobs` migration.
3. Submit on master completion.
4. Callback handler + asset registration + conditional flip.
5. GC visibility and retry.
6. Reconcile pass for lost events.
7. One real title, manually verified.
8. Backfill runbook — founder executes.

## 10. Out of scope

- Multiple renditions or adaptive bitrate. One proxy.
- Watermarking or DRM.
- Re-encoding anything delivered to a vendor. §12's actual rule, unchanged.
- Captions/subtitle burn-in.
- Trailer or artwork processing — clients supply those and they are already instant.
