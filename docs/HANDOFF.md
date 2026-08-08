# Handoff — globalcontent-dashboard

**Written 2026-08-07.** Everything described here is merged to `main`. No feature branches remain.
Work from `main`, and `git pull` before you trust any state described below.

You are taking over a partly-built feature. Read this whole file before touching anything.

---

## What this project is

The authenticated client dashboard for **Global Content's Content Distribution** business. Rights
holders sign a licensing agreement, submit film titles and platform-ready master files, and track
delivery to streaming platforms. GC staff deliver by hand — there are no platform APIs.

Next.js 16 App Router on Vercel (Pro), Supabase Postgres, AWS S3 + CloudFront + MediaConvert,
TypeScript strict, Vitest + pgTAP.

**Tier 3.** Real external users, PII, signed contracts, rights-holder revenue data, payouts. Treat
it accordingly.

---

## Read these first, in order

1. **`CLAUDE.md`** (repo root) — non-negotiable rules. Read "Golden rules" and "Known Gotchas" twice.
2. **`docs/domain-spec.md`** — the domain model. The spec beats the code; if they disagree, the code is wrong.
3. **`docs/superpowers/specs/2026-08-06-buyer-title-page-design.md`** — shipped, and amended
   post-ship; and **`docs/superpowers/specs/2026-08-06-screener-proxy-design.md`** — the feature
   still in flight.
4. **`docs/superpowers/plans/2026-08-06-screener-proxy.md`** — the plan you are executing.
5. **`docs/superpowers/ledgers/2026-08-06-screener-proxy.md`** — the execution ledger.
   **This is the highest-value file in the repo for context.** There is a sibling ledger,
   `docs/superpowers/ledgers/2026-08-06-buyer-title-page.md`, covering the other branch.
   (These were promoted out of a gitignored scratch workspace at `.superpowers/` precisely so
   that a new reader actually receives them.)

> **When something in the code looks like over-engineering, search the ledger before "simplifying"
> it.** The pre-recorded output key, the partial unique index, the corroboration gate, the
> author-partition removal — each is the resolution of a specific bug, and the ledger says which.
> The ledger records the *reasoning*, which is the part a diff does not carry.

---

## Git state

All merged. PR #87 (buyer title page, complete), PR #89 (screener proxy through Task 5), and
PR #93 (Task 6A — read-only GC proxy-job panel) are on `main`. #88 was auto-closed when its base
branch was removed by the #87 merge and is superseded by #89 — ignore it.

Verified on `main` after PR #93 (`0c778eb`, reviewed implementation `0f4ed63`): typecheck clean,
**318 Vitest tests**, **504 pgTAP assertions**, build compiles, `pnpm exec eslint src` reports 0
errors and exactly 5 pre-existing warnings. Required CI `isolation` passed; Vercel passed; `checks`
stayed red only on the documented pre-existing `pnpm audit` advisories (`js-yaml` / `nanoid`). All
migrations applied to the **local** database — the production database is a separate matter, below.

**CI on `main` is partly red, in two independent places, and neither is a regression you
introduced.**

1. **`checks` fails on the dependency audit.** `pnpm audit` reports 4 vulnerabilities (2 high, 2
   moderate): `js-yaml`, transitive under **`eslint`** (`eslint > @eslint/eslintrc > js-yaml`), and
   `nanoid`, transitive under `next`/`postcss`. It predates this work, `main` fails it
   independently, and no branch here changed `package.json`. It is **not** a required status check;
   the only required one is `isolation`, which passes. Worth fixing on its own merits.
2. **`migration-drift` fails because the production database is behind `main` by 7 migrations** —
   `20260806000100` through `20260807000200`. That means the buyer title page and `transcode_jobs`
   **do not exist in production**, though both are on `main` and deployed as code. The workflow is
   doing exactly its job (it exists because code auto-deploys on Vercel while applying a migration
   is a separate manual step), so **do not "fix" it in code**. Applying those migrations to prod is
   a founder step under the hard rules below.

---

## The feature in flight

Client masters are commonly ProRes or DNxHD — unplayable in a browser — and archive to Glacier at
90 days. So the buyer-facing title page currently shows a poster, a synopsis and a metadata
download, and nothing playable. **The page is built and correct and does not yet do its job.**

This slice generates one small H.264 proxy per master via AWS MediaConvert, registers it as a
`screener` asset, and flips `titles.screener_source` to `dedicated` — **but only when it is still
at its `master` default.** An explicit client choice is never overridden. That is a founder
decision, not an implementation detail.

### Done

| Task | Deliverable |
|---|---|
| 1 | AWS runbook — `docs/infra/screener-proxy-setup.md` |
| 2 | `transcode_jobs` table + three RPCs — `supabase/migrations/20260807000100_transcode_jobs.sql` (applied **locally**; not yet in prod — see Git state) |
| 3 | Deterministic output-key derivation — `src/lib/mediaconvert-settings.ts` |
| 4 | Job submission on master upload — `src/lib/mediaconvert.ts`, hooked in `src/app/api/assets/complete/route.ts` |
| 5 | Scheduled poll — `src/app/api/cron/transcode-poll/route.ts`, `vercel.json` |
| 6A | Read-only GC “Proxy jobs” panel — PR #93 (`0f4ed63`). Bounded title-scoped `transcode_jobs` read inside the page `Promise.all`; status, created time, failure reason, output screener; stuck when active and strictly older than 60 minutes. No heartbeat; no retry. |

### Remaining

| Task | Deliverable |
|---|---|
| 6B | Retry action on that panel — mutation |
| 7 | Narrow amendment to `docs/domain-spec.md` §12, which currently states GC never transcodes |
| 8 | Backfill runbook for ~700 existing masters — founder-executed, spends real money |

**Next slice is Task 6B.** 6A/6B was an execution split of the plan’s existing Step 1 / Step 2
boundary, not a scope change. 6A is done; 6B is the second half of Task 6 and Task 6 is not done
until it ships. 6B is a separate mutation slice: no new schema expected unless implementation
evidence proves otherwise; preserve existing authorization/RPC boundaries; get retry eligibility
right against the partial unique index `transcode_jobs_active_key_uidx` (retrying an already-
`complete` job is a unique-constraint violation, not a no-op — **do not retry completed jobs**);
AWS submit and job-recording failure paths must be explicit and tested.

### Review status of `432ecbb` — code review satisfied, production validation **not**

`432ecbb` is the third fix round on the poll. It reserves a write budget (`WRITE_BUDGET_MS`) so the
route cannot defer 100% of its writes while still returning HTTP 200, decouples the corroboration
gate from the `CONCURRENCY` constant (the old gate inferred full visibility from cohort size, so
`CONCURRENCY = 1` would have let a truncated systemic-fault cohort through to a permanent fail),
and splits "absent" from "empty" so a 0-byte output no longer counts as evidence of systemic
absence.

**The code-review obligation on it is now discharged.** Two agents reviewed it independently —
Cursor and Codex, each from its own orientation pass, without access to the other's conclusion —
and converged on the same reading: correct as written, safe to build on, with the residual risks
below unchanged. The author had already mutation-checked both Importants by hand (reverting the
write-budget reservation fails exactly the new test; forcing a C1 truncation under `CONCURRENCY = 1`
still reports the absent job held).

**Read that narrowly. Reviewed is not validated, and nothing here says the pipeline works.**

- Every residual risk recorded at the foot of the T5 ledger entries still stands, unreduced:
  Supabase calls carry no timeout, there is no heartbeat, `rotate()` bounds head-of-queue
  starvation without draining a backlog, and `MASS_DEFERRAL_RATIO`/`TOTAL_FAILURE_FLOOR` are
  judgment calls with no production data behind them.
- **Nothing in this pipeline has executed against real AWS.** Three reviewers reading the same
  code agree only that the code says what it means to say. This repo has been burned six times by
  exactly that distinction (see the lesson at the foot of this file). **One real master through
  the real pipeline remains the gate** before any of it is trusted.
- **The `s3:ListBucket` ordering constraint is untouched and still in force** — the grant must not
  reach production ahead of this code. See the section on it below; it is the one item in this
  slice that can destroy data permanently.

**Known gap in the poll, documented and accepted:** the Supabase calls have no timeout — only the
AWS calls do. A hung Postgres query can still blow the function's deadline. It is *data-safe*
(both RPCs are row-locked and idempotent, so a killed invocation leaves no partial state) but
*observability-unsafe*: the summary, the stuck warning and the 503 are all lost, and with no
heartbeat table yet, a persistently hung database presents as a silently absent cron. Two
thresholds — a 50% mass-deferral trigger and a 3-job total-failure floor — are judgment calls with
no production data behind them and should be revisited once there is any.

---

## Open security finding — founder decision, not yours to close alone

A client can read the raw `share_token` of **GC's own unnamed screener link** on their title.
Unification (`20260806000300`) deliberately removed the clause hiding GC-authored rows, on the
founder's reasoning that it is the client's title and their revenue. Separately, the interim stream
gate exempts unnamed links from the master-source refusal, so GC's operational review links keep
working.

Together: a client can lift GC's token, open the portal, pass the OTP with any email they control,
and stream the master. That is the same bypass `20260806000500` closed on the *write* path (a client
must name a buyer), reopened through the *read* path.

**Severity:** it is their own title and their own master — they could already download it and hand
it to anyone — so it is not an escalation of reachable data. It is a control that can be walked
around, which tends to surface at the worst moment.

**Likely fix:** stop exempting unnamed links once GC's review flow has a real dedicated screener,
which the proxy work delivers anyway. Full write-up at the foot of
`docs/superpowers/ledgers/2026-08-06-screener-proxy.md`.

---

## The B3 isolation harness was rewritten — do not "restore" it

`scripts/security/b3-cross-org-isolation.mjs` is the required `isolation` CI check. It used to
assert that `portal_links` was a GC-only table a client sees zero rows in. Unification repealed
that rule, so the probes were rewritten to assert what is now true: a client sees **exactly** its
own `screener_view` rows, **zero** `master_download` rows, and **zero** rows for any other org.

That is strictly stronger than what it replaced. There is a `KNOWN_OPEN` baseline at the foot of
that file — it is empty and must stay that way. Its own comment says a baseline is a list of known
defects, not a place to park them. **Never add an entry to make CI green.**

---

## Every known open issue

Complete as of 2026-08-07, re-verified against `main` the same day. Nothing here is a surprise
waiting in the code — it is all either recorded in a ledger or visible in CI. Detail for each lives
in `docs/superpowers/ledgers/`.

**Needs a founder decision — do not close these alone**

| Issue | Where |
|---|---|
| Unnamed-link master-stream bypass (see the section above) | screener-proxy ledger, foot |
| The **production database is 7 migrations behind `main`** (`20260806000100`–`20260807000200`), so the buyer title page and `transcode_jobs` are live as code and absent as schema. Only the founder applies migrations | `migration-drift` CI |
| `revoke_portal_link` has no status gate, while `create_screener_link` does. A client `account_owner` can revoke GC's chain-of-title review link on an `in_review` title, via the RPC though not the UI. Self-defeating rather than dangerous — GC can re-mint — so it was left open, but never actually decided | buyer-title-page ledger |
| The ~$700 backfill (Task 8) spends real money and is founder-executed | plan, Task 8 |

**Architectural debt with a known correct fix**

| Issue | Note |
|---|---|
| The rule-12 licence check exists in **three** implementations — `portal_resolve_download` (SQL), `src/lib/master-licence.ts` (TS), `title_vendor_licensed` (SQL). They agree today and a parity test pins the status list, but they have already drifted once. Correct fix is a shared `portal_resolve_buyer_master` RPC | needs a migration |
| `create_asset` lacks the key-scope check that `create_transcode_job` gained. Same shape of gap, standing repo-wide | needs a migration |
| TOCTOU between `portal_resolve_screener` resolving a key and the route re-reading `screener_source`. Narrow; closed by having the RPC return the resolved asset's kind | needs a migration |
| **A stopped cron is invisible.** A count computed inside the poll cannot report the poll's own absence, and nothing persists one. **Task 6 does not depend on this** — see below | future migration, not a Task 6 blocker |

> **What Task 6 does and does not need here.** Task 6's panel derives stuck state from
> `transcode_jobs.status` + `created_at` — an active job older than the threshold reads as stuck.
> That data ages correctly **whether or not the poll ever ran**, which is exactly why the panel is
> not blocked on a heartbeat. What it cannot do is tell you *which* thing stopped: a stopped cron
> and a stalled MediaConvert job produce the identical aging row. Persistent heartbeat state would
> separate those two, and only those two. It is a **separate observability slice and a future
> founder-approved schema change** — not a prerequisite folded into Task 6, and not approved. A
> proposed shape is recorded in the screener-proxy ledger, explicitly as *proposed, not built*.

**Poll robustness (all in `src/app/api/cron/transcode-poll/route.ts`)**

- Supabase calls carry no timeout; only the AWS calls do. Data-safe, observability-unsafe.
- Head-of-queue starvation is **bounded, not eliminated**. `rotate()` (fix round 2, `e4ab173`) shifts the in-memory processing order once per tick, so no job permanently owns the head. A permanently-erroring job still spends budget whenever its turn comes up early, and rotation guarantees each job an eventual early slot rather than throughput. Never exercised against a real backlog.
- The `allErrored` 503 is a hair trigger at low volume, and the 50% mass-deferral and 3-job floor thresholds are judgment calls with no production data behind them.
- `src/lib/s3.ts` throws at module load if `S3_BUCKET`/`AWS_REGION` are unset. Twenty modules import it, and Next.js evaluates route modules during `next build` — so a Vercel environment missing either variable fails to **build**, not merely to serve. CI does not run `pnpm build`.

> **Two items that were on this list are closed and must not be re-added:** `rotate()` and the
> `withTimeout` around `headObjectMeta` both gained direct test coverage in `432ecbb` (`rotate` was
> exported for exactly that purpose; see `src/app/api/cron/transcode-poll/route.test.ts`). The fix
> rounds behind them are recorded in the screener-proxy ledger.

**Test and doc quality, low risk**

- `request-otp`'s zod schema is inlined and untested, so a re-introduced `.optional()` would not be caught.
- `screener_test.sql:681` pins the same field its WHERE clause filters on, degenerating to an existence check.
- Buyer-page `test 5` is not load-bearing; there is no `titleStatus: null` case.
- `portal_links_purpose_shape` was not extended for the new `vendor_id`/`recipient_name` columns. Unreachable today — direct INSERT is revoked from `authenticated`.
- Two-tab race: both tabs can pass the buyer-name collision check before either commits. Narrows the silent-replace window rather than closing it.
- Filename slugs strip non-ASCII rather than transliterating, so international titles read poorly.
- `20260806000500`'s header understates its own insertion size.

**Pre-existing, not from this work**

- `pnpm audit` reports 4 vulnerabilities (2 high, 2 moderate) — `js-yaml` transitive under `eslint`, `nanoid` transitive under `next`/`postcss`. `main` fails the non-required `checks` job on this. No branch here changed `package.json`.

---

## Hard rules you must not break

- **Never run migrations, `psql`, `supabase db reset`, or `supabase db push`.** A `PreToolUse`
  hook blocks them. Show the founder the exact SQL and let him apply it. This is not ceremony — it
  is how every schema change in this repo has shipped, and four separate migrations were caught in
  review after looking correct.
- **`pnpm`, never `npm`.** Verify with
  `pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build`.
  Baseline: 0 eslint errors, exactly 5 pre-existing warnings in `src`. `pnpm lint` is red from
  unrelated worktree files — lint `src` only.
- **RLS is the authorization layer.** Mutations go through `SECURITY DEFINER` RPCs, never
  client-side permission checks. A UI-only rule is not a rule.
- **Any RPC parameter a caller may omit needs `default null` in SQL**, or the type generator marks
  it required and breaks callers. This has bitten five times.
- **Never hand-edit `src/lib/supabase/database.types.ts`.** It is generated. A hand-edit faking a
  nullable argument was silently reverted by the next regeneration and broke the build with an
  error pointing at an unrelated call site.
- **Nothing is ever deleted.** Status changes and supersession only.
- **Never read, print or commit `.env` / `.env.local`.** Secrets are server-only; never
  `NEXT_PUBLIC_`.
- **Independent Supabase queries in a server component must be `Promise.all`'d**, and list reads
  must be bounded via `@/lib/list-bounds`.
- **Never call `supabase.auth.getUser()`** — use `getAuthUser()` / `getOrgContext()` from
  `@/lib/supabase`.

---

## One ordering constraint that can cause permanent data loss

The AWS runbook grants **`s3:ListBucket`**. **It must not be applied to production before the poll
code is deployed.**

Without that permission, S3 answers a `HeadObject` on a missing object with **403**, and the poll
harmlessly retries. With it, S3 answers **404**, and the poll permanently fails the job —
irreversibly, because nothing here is ever deleted and `register_transcode_output` refuses a
non-active job. Recovery would require a fresh job row per title.

A systemic cause — a wrong `S3_BUCKET`, a key-derivation drift, MediaConvert appending an
extension — would take the entire in-flight fleet down in one five-minute tick. The corroboration
gate added in `432ecbb` is what makes the grant safe.

The runbook says this. It is a human-executed step and easy to run straight through.

---

## The lesson this project has taught repeatedly, at real cost

**Six separate times, something passed review and failed the moment it was executed:**

1. An S3 lifecycle rule filtering on a mid-key prefix — matched **zero objects** while showing
   green and enabled in the console.
2. A unit test that could not fail — it passed against an unchanged codebase.
3. pgTAP assertions that never ran, because `audit_log` has no `created_at` column; the file
   aborted at assertion 71 of 77 and the rest silently never executed.
4. A leak-check grepping the built bundle for env-var **names**, when Next.js inlines the
   **value** — a genuinely leaked secret would have printed `clean`.
5. A SQL guard that did not guard, because `btrim(NULL) <> 'key'` is `NULL` and `if NULL then`
   does not branch. Execution fell straight through into the write.
6. A test running under a database role that could not execute the function it was testing — it
   raised a permission error, not the constraint violation it asserted.

They are one shape: **verification that cannot fail.**

**So: prefer executing over reading.** When you claim something works, say what you ran and paste
the output. When you write a test, mutate the code it covers and confirm it actually fails —
several tests in this repo were only proven meaningful that way, and two were found meaningless.
Four reviewers read the buyer page and confirmed a private label was not rendered; it took loading
the actual page to find it sitting in the payload where the buyer could read it.

**The same trap catches your own tooling, not just the code.** Twice in this project a check was
run against stale local state and reported what was asked rather than what was true — most
expensively, `git merge-base --is-ancestor main <branch>` said a fast-forward was possible when the
comparison was against a **local** `main` that had not been fetched. The remote had moved and the
merge failed. Fetch before you compare; regenerate before you diff; re-run before you report.

**Nothing in the transcoding pipeline has ever run against real AWS.** The runbook
(`docs/infra/screener-proxy-setup.md`) has not been applied. Given the list above, treat one real
master through the real pipeline as the gate before trusting any of it — not as a final polish step.

---

## Start here

1. Read `docs/superpowers/ledgers/2026-08-06-screener-proxy.md` end to end.
2. Run `pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build` to confirm the baseline
   (318 Vitest tests after Task 6A).
3. Read the shipped Task 6A surface — `src/lib/transcode-jobs.ts` and
   `src/app/(app)/(operator)/gc/titles/[id]/transcode-panel.tsx` — then Task 6B.

Ask the founder before: any schema change, anything touching money or rights, any user-facing copy,
and any decision the spec does not already settle. Record decisions in the spec in the same change
that makes them.
