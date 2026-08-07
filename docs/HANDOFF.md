# Handoff — globalcontent-dashboard

**Written 2026-08-07.** Current branch `feat/screener-proxy`, HEAD `432ecbb`, working tree clean.

You are taking over two in-progress feature branches. Read this whole file before touching anything.

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
3. **`docs/superpowers/specs/2026-08-06-buyer-title-page-design.md`** and
   **`docs/superpowers/specs/2026-08-06-screener-proxy-design.md`** — the two features in flight.
4. **`docs/superpowers/plans/2026-08-06-screener-proxy.md`** — the plan you are executing.
5. **`.superpowers/sdd/2026-08-06-screener-proxy/progress.md`** — the execution ledger.
   **This is the highest-value file in the repo for context.** There is a sibling ledger at
   `.superpowers/sdd/2026-08-06-buyer-title-page/progress.md`.

> **When something in the code looks like over-engineering, search the ledger before "simplifying"
> it.** The pre-recorded output key, the partial unique index, the corroboration gate, the
> author-partition removal — each is the resolution of a specific bug, and the ledger says which.
> The ledger records the *reasoning*, which is the part a diff does not carry.

---

## Git state

Nothing is pushed. Both branches are local.

| Branch | State |
|---|---|
| `feat/buyer-title-page` | **35 commits ahead of `main`. Complete, reviewed, fully tested. Should be merged.** |
| `feat/screener-proxy` | 20 commits beyond that. In progress — current branch. |

Working tree clean. All migrations applied locally. **286 Vitest tests** and **504 pgTAP
assertions** green. `pnpm exec eslint src` reports 0 errors and exactly 5 pre-existing warnings.

Merging `feat/buyer-title-page` is the cheapest useful thing available and reduces rebase risk on
20 commits of work stacked behind it.

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
| 2 | `transcode_jobs` table + three RPCs — `supabase/migrations/20260807000100_transcode_jobs.sql` (applied) |
| 3 | Deterministic output-key derivation — `src/lib/mediaconvert-settings.ts` |
| 4 | Job submission on master upload — `src/lib/mediaconvert.ts`, hooked in `src/app/api/assets/complete/route.ts` |
| 5 | Scheduled poll — `src/app/api/cron/transcode-poll/route.ts`, `vercel.json` |

### Remaining

| Task | Deliverable |
|---|---|
| 6 | GC panel showing job status with a retry action |
| 7 | Narrow amendment to `docs/domain-spec.md` §12, which currently states GC never transcodes |
| 8 | Backfill runbook for ~700 existing masters — founder-executed, spends real money |

### Immediately outstanding

**Commit `432ecbb` has not been re-reviewed.** It reserves a write budget so the poll cannot defer
100% of writes while returning HTTP 200, decouples the corroboration gate from the `CONCURRENCY`
constant, and stops 0-byte outputs counting as evidence of systemic absence. Review it before
building on it.

**Known gap in the poll, documented and accepted:** the Supabase calls have no timeout — only the
AWS calls do. A hung Postgres query can still blow the function's deadline. It is *data-safe*
(both RPCs are row-locked and idempotent, so a killed invocation leaves no partial state) but
*observability-unsafe*: the summary, the stuck warning and the 503 are all lost, and with no
heartbeat table yet, a persistently hung database presents as a silently absent cron. Two
thresholds — a 50% mass-deferral trigger and a 3-job total-failure floor — are judgment calls with
no production data behind them and should be revisited once there is any.

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

---

## Start here

1. Read `.superpowers/sdd/2026-08-06-screener-proxy/progress.md` end to end.
2. Run `pnpm typecheck && pnpm test && pnpm exec eslint src && pnpm build` to confirm the baseline.
3. Review commit `432ecbb`.
4. Then Task 6.

Ask the founder before: any schema change, anything touching money or rights, any user-facing copy,
and any decision the spec does not already settle. Record decisions in the spec in the same change
that makes them.
