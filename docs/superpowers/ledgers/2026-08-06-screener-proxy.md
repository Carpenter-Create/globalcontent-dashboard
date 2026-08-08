# SDD ledger — plan: docs/superpowers/plans/2026-08-06-screener-proxy.md

Branch: feat/screener-proxy (from 283ec35, itself off feat/buyer-title-page @ 81752a5)
Pre-flight: Task 1 is a runbook the FOUNDER applies; Task 2 writes SQL and STOPS for
approval. Tasks 4-7 can be built and unit-tested without AWS, but cannot be verified
end-to-end until MediaConvert exists in the account. The spec makes one real master
through the real pipeline mandatory before any backfill.
Founder decisions already made: (1) screener_source flips ONLY from the 'master'
default, never overriding an explicit 'dedicated'; (2) backfill is one pass, ~700
titles, ~$700, executed by the founder — no task here spends money.

Proxy T1: implemented (commit b2dc68a). Implementer CORRECTED AN ERROR IN MY BRIEF:
  I wrote the IAM resource as orgs/*/master/* — the same mid-key mistake that made
  the Glacier rule match zero objects. Real shape is orgs/*/titles/*/master/*.
  They proved the fix with iam simulate-principal-policy rather than asserting it.
Proxy T1: review — spec OK, NOT approved, 2 Critical:
  (a) the one-real-job verification cannot run: QVBR rate control without
      QvbrSettings fails validation, so every downstream check observes nothing.
  (b) the leak check greps for env var NAMES; Next.js inlines the VALUE, so a real
      leaked callback secret would print "clean". The document's own thesis
      failing on the document's own security step.
  + EventBridge trust policy has no aws:SourceArn condition (confused deputy).
Proxy T1: fix round 1/5 dispatched.
Proxy T1: fix round 1/5 (3 addressed; b2dc68a..7d53236). Reviewer built a
  per-verification table for the whole runbook: every other check proves
  observable state. STEP 6 was the only instance of the defect class.
Proxy T1: complete (commits 283ec35..7d53236, review clean)
Proxy T1: minor (deferred): the TEST_JOB_ID guard prints but does not exit, so a
  pasted block continues past a rejected create-job (AWS CLI then errors loudly).
Proxy T1: minor (deferred): grep -q drops the matched file/line, trading location
  for per-secret attribution.
Proxy T1: accepted limitation: the confused-deputy check is existence-based. IAM
  simulate does not model a service principal's AssumeRole with AWS-injected
  aws:SourceArn, so behavioural proof would need a throwaway rule. Labelled
  honestly in the doc rather than dressed up as equivalent to the other proofs.
Proxy T2: implemented (commit 18c1746, plan 44). Spec OK. NOT approved.
Proxy T2: CRITICAL — a NULL p_storage_key bypasses the key check entirely.
  btrim(NULL) is NULL; NULL <> 'key' is NULL; `if NULL then` does not branch, so
  execution falls through to the insert. Reachable by a malformed EventBridge
  payload, no attacker needed. Registers a screener for a nonexistent object,
  flips screener_source so the portal stops serving the master and 404s every
  live buyer link on that title, and locks the job complete with no recovery
  path through any RPC (the asset is immutable and never deleted).
Proxy T2: + read-then-write idempotency with no FOR UPDATE (at-least-once
  delivery is the case the header names and does not handle); grant update to
  service_role defeats the key check entirely; missing revoke-all-from-anon and
  service_role keeps DELETE — invisible on a fresh rebuild, appears only in
  production; content_hash/bytes unvalidated into an immutable provenance field;
  expected_output_key not unique so a retry can register twice.
Proxy T2: fix round 1/5 dispatched.
Proxy T2: fix round 1 (agent died on an API error AFTER completing the work and
  BEFORE committing; coordinator committed as a0033de, honestly labelled).
  Verified closed: the NULL bypass, FOR UPDATE serialisation, anon revoke,
  DELETE revoke, content_hash/bytes validation, kind check, plan 44->53.
Proxy T2: fix round 2 (b85b843, plan 61) — but the FIRST fix was itself
  incomplete: removing the explicit `grant update to service_role` did NOT remove
  the IMPLICIT one, because on the production image new tables arrive with full
  DML. service_role kept INSERT/UPDATE and is BYPASSRLS, so the callback could
  have updated the job row directly and skipped the key check — the exact threat
  the header claimed to close. Now an unconditional revoke-all + grant-select,
  identical on both images.
  Also caught FORWARD: a flat UNIQUE on the deterministic output key would have
  made Task 7's retry raise 23505 forever. Replaced with a partial unique.
Proxy T2: fix round 3/5 dispatched — the partial index released the key on
  'complete', so a retry after a SUCCESSFUL registration produced a second
  immutable asset at the same key (portal serves the newer, the older is orphaned
  describing an overwritten object). One-word predicate fix. Plus a tenant-scope
  guard on the client-supplied expected_output_key.
NOTE: three rounds running, the implementer's report has overstated a grep result
  each time. Substantive conclusions held; the verification claims did not.
Proxy T2: fix round 4 (dbe82e2, plan 64) — test role corrected, reachability
  claim fixed (a re-upload does NOT collide; assetKey mints a fresh UUID — the
  real path is a resubmit against the SAME assets row, which T6/T7 must handle),
  scope check made NULL-safe and anchored on the screener segment.
Proxy T2: coordinator fixed one mechanical type cast directly (assets.bytes is
  bigint, literal was integer, pgTAP is() needs matching types — the file aborted
  at assertion 40/64). Commit 3c9840a. No review cycle spent on a cast.
Proxy T2: APPLIED by founder. 27 files / 503 assertions PASS, transcode_jobs 64.
PROCESS CHANGE (founder, 2026-08-07): full review stays on the database and any
  publicly reachable endpoint. Ordinary code gets one review pass instead of a
  fix/re-review loop, and the saved effort goes into ACTUALLY RUNNING things —
  today's end-to-end run found what four reviews missed.
Proxy T3+T4: implemented (a3760d6, 1c1cf86), types trap fixed (28949f0).
  Review NOT approved: 2 Critical. (a) encoding settings paired VBR with
  MaxBitrate, a QVBR-only field — AWS would reject every job, silently, because
  T4 swallows transcode errors. Notably the settings PROVEN against real AWS in
  the runbook were not the settings the code sent. (b) detach requires the
  unapplied 20260807000200. Plus: filename regex matched '/', no test tied the
  derived key to the SQL that must accept it, uppercase UUIDs defeat the LIKE.
Proxy T3+T4: fixed (a32ebe9, plan 65, 243 tests) — settings now match the proven
  QVBR shape verbatim, justified against SDK doc strings.
TYPES TRAP (found by RUNNING the generator, not reading): database.types.ts held
  a hand-edit the generator reverts. Regenerating silently broke the build, with
  the error pointing at a call site rather than the cause. Root-caused to a
  missing SQL DEFAULT; fixed at the SQL level so no hand-edit is needed.
ARCHITECTURE CHANGE (founder, 2026-08-07): POLL, not push. Deletes the public
  callback endpoint, the shared secret, EventBridge, the API destination and its
  confused-deputy trust policy. Tasks 5+6 merged into one scheduled poll.
  Vercel Pro confirmed — minute-level cron available. Spec/plan/runbook revised
  (e9f043a). Renumbered: 5 poll, 6 GC visibility, 7 spec amendment, 8 backfill.
IAM GAP (found during replan): the runbook granted the MediaConvert SERVICE its
  permissions but never granted the APP mediaconvert:CreateJob or iam:PassRole.
  Submission would have failed access-denied on every master — silently, since
  T4 swallows it. Fixed (d6e89df), PassRole scoped with iam:PassedToService, and
  all four actions restated so a re-run cannot drop the earlier GetJob/ListJobs.
20260807000200 APPLIED by founder — detach on buyer links works again. 504 pgTAP.
Types verified by REGENERATING against the applied DB: the p_vendor_id?: string
  prediction held, but the Enums constants array was still missing
  transcode_status (the earlier pass fixed the type union only). Fixed. The file
  now differs from generated output by exactly 4 comment lines.
Proxy T5: implemented (60d1a8b, 261 tests, auth mutation-verified). Review NOT
  approved — 6 Important. The two best were an interaction no single file shows:
  (a) gc-assets-app has no s3:ListBucket, so HeadObject on a MISSING object
      returns 403 not 404 — the "object absent" branch can never fire in prod,
      and such a job is re-polled every 5 minutes forever.
  (b) the same 404 check also matches NoSuchBucket, so a wrong/unset S3_BUCKET
      would mark every SUCCESSFUL transcode permanently failed — effectively
      irreversible (register refuses non-active jobs, nothing is ever deleted).
  headObjectMeta — the branch deciding "permanently failed" — had NO tests.
  Also: the bounded/status-filtered select test passes against a route with
  neither; the stuck signal cannot report its own absence; no maxDuration on a
  serial loop over up to 500 jobs x 2 AWS calls.
Proxy T5: fix round 1/5 (2a937bb) — 4 of the 6 closed; the review findings above
  stand as written, this records what answered them.
  (a) headObjectMeta narrowed to the SDK's own modeled "NotFound"; the
      statusCode===404 fallback (which also matched a renamed bucket) dropped.
      S3_BUCKET/AWS_REGION validated at MODULE LOAD, so an unset bucket can no
      longer reach HeadObject as `Bucket: undefined` and be misread as absent.
      The residual was documented honestly rather than papered over: HeadObject
      answers a missing KEY and a missing BUCKET with an identical bodyless 404,
      verified against the SDK's own waiter source. Left open here; closed in
      round 2.
  (b) the runbook restates the full gc-assets-app policy WITH s3:ListBucket plus
      a verify step. This is the grant that turns a missing object from a
      harmlessly-retried 403 into a permanent fail — hence the ordering
      constraint; round 2's corroboration gate is what makes the grant safe to
      apply.
  + maxDuration, a time budget, and bounded concurrency, against the unbounded
    serial loop.
  + regex "already complete" detection replaced by a status peek immediately
    before each write: the regex could not distinguish a genuine race from a
    not-found job, and had no equivalent on the register path.
  + s3.test.ts gains the table-driven headObjectMeta coverage that did not exist
    before this round — the branch deciding "permanently failed" had none.
  + the bounded/status-filtered select assertion now pins the real .in/.range
    calls, mutation-checked: removing .in fails THAT test and nothing else.
  STILL OPEN after this round: heartbeat persistence (needs a table, so
  founder-approved migration only) and the 404-vs-missing-bucket ambiguity.
Proxy T5: fix round 2/5 (e4ab173) — closes round 1's standing residual, and
  restructures the route around the irreversibility problem.
  + Phases (resolve AWS status -> check object presence for EVERY complete job
    -> corroboration gate -> write), so no job is permanently failed until every
    COMPLETE job's check result is known. More than one COMPLETE job in a tick
    with ALL outputs missing is read as a CONFIGURATION FAULT rather than N
    independent failures: none written, all held for the next tick, response
    forced non-200. A lone complete-but-missing job still fails normally.
    THIS IS WHAT MAKES THE s3:ListBucket GRANT SAFE — ship the grant and this
    logic together, never the grant alone.
  + s3.ts issues HeadBucket on the NotFound path to tell a missing key from a
    missing bucket, using the permission round 1 had already granted. Separate,
    tightly-timed pollS3 client so a large multipart assembly's legitimately
    longer latency is never affected.
  + every AWS call also raced against its own 10s ceiling (withTimeout),
    independent of client config — a between-batch budget check cannot bind if
    one call hangs forever. Proven with a never-resolving mock under fake timers.
  + rotate() shifts in-memory processing order each tick (SQL ordering
    unchanged), so a persistently-bad head-of-queue job no longer consumes the
    whole budget while the tail defers indefinitely. TOTAL_FAILURE_FLOOR (3)
    stops one transient blip tripping the total-outage 503.
  + CLAUDE.md gotcha recorded: the module-load env guard turns a missing
    S3_BUCKET/AWS_REGION into a `next build` failure, not merely a runtime one,
    and CI's checks job never runs `pnpm build`.
Proxy T5: fix round 3/5 (432ecbb) — three defects in round 2's OWN work.
  + Writes now run against a SEPARATELY RESERVED deadline (WRITE_BUDGET_MS, 20s)
    rather than whatever the checking phases left. A busy tick previously
    deferred 100% of writes — including registers for objects already CONFIRMED
    PRESENT — and still reported 200, because "every job errored" never covers
    "every job deferred". massDeferral (>=50% of a tick's jobs, above a sample
    floor) added to the unhealthy signal.
  + The corroboration gate no longer infers full visibility from cohort size.
    That invariant was an UNSTATED COUPLING to CONCURRENCY — runBatched returns
    only 0, a multiple of CONCURRENCY, or everything — so setting CONCURRENCY to
    1, a plausible throttling response, would have let a truncated systemic-fault
    cohort of one through to a permanent fail. Now holds whenever phase C1 itself
    was truncated. Also corrected the inverted reasoning in the prior report:
    FIRING is what withholds the irreversible write, so firing LESS is the unsafe
    direction.
  + "absent" (confirmed 404) split from "empty" (0 bytes). A 0-byte object proves
    the bucket is reachable and the key exact — evidence AGAINST a systemic fault,
    not for one. It now always fails normally and is excluded from the gate's
    math, so two genuine 0-byte encodes in one tick can no longer be held forever
    with no resolution path.
  + rotate() exported and directly unit-tested (previously ZERO coverage —
    removing the call left every test green), and the withTimeout wrapping
    headObjectMeta given the coverage only the GetJob hang had. NOTE, because a
    handoff open-issues list carried these as outstanding after the fact: both
    are CLOSED HERE. rotate has five dedicated tests and the HeadObject-hang
    timeout test exists; re-adding them as open issues would be a regression in
    the record, not a finding.
  Both Importants mutation-checked by hand: reverting the write-budget
  reservation fails exactly the new test; CONCURRENCY=1 with a forced C1
  truncation still reports the absent job HELD, and reverting the gate's
  corroborationIncomplete check flips held back to 0.
Proxy T5: complete (60d1a8b..432ecbb). Re-verified on main 2026-08-07 by running,
  not reading: typecheck clean, 286 Vitest tests across 31 files, 0 eslint errors
  and 5 pre-existing warnings in src, build compiles.
RESIDUAL RISK carried deliberately out of T5 — accepted, not forgotten, and not
  defects to rediscover as new:
  - Supabase calls carry NO timeout; only the AWS calls do. Data-safe (both RPCs
    are row-locked and idempotent, so a killed invocation leaves no partial
    state) but observability-unsafe: the summary, the stuck warning and the 503
    are all lost when Postgres hangs.
  - No heartbeat table, so the poll still cannot report its own ABSENCE. T6's
    panel must compute staleness from transcode_jobs.status + created_at — data
    that exists whether or not this route ran — never from a number the route
    produced. Persisting a heartbeat needs a migration, so it is a founder step.
  - rotate() BOUNDS head-of-queue starvation; it does not drain a backlog. A
    permanently-erroring job still spends budget whenever its turn comes up
    early, and rotation guarantees each job an eventual early slot, not
    throughput. Never exercised against a real backlog.
  - MASS_DEFERRAL_RATIO 0.5 and TOTAL_FAILURE_FLOOR 3 are judgment calls with no
    production data behind them. Revisit once there is any.
  - NOTHING in this pipeline has run against real AWS. The runbook is unapplied.
    One real master through the real pipeline is the gate, not a polish step.
MERGED to main 2026-08-07 as PR #89 (12cadf1), at 5 of 8 tasks. At that point
  remaining were T6 GC visibility + retry, T7 the narrow domain-spec §12
  amendment, T8 the founder-executed backfill. The migrations this slice added
  are applied LOCALLY; the prod database is behind main (see HANDOFF's Git
  state section). T6A later completed separately — see below.

=== REVIEW STATUS: 432ecbb — code review discharged 2026-08-07 ===
WHAT WAS REVIEWED: fix round 3/5 in full — the reserved write deadline
  (WRITE_BUDGET_MS) that stops a busy tick deferring 100% of writes while still
  answering 200; massDeferral joining the unhealthy signal; the corroboration
  gate no longer inferring full visibility from cohort size (the old form was an
  unstated coupling to CONCURRENCY, so CONCURRENCY=1 would have let a truncated
  systemic-fault cohort through to a PERMANENT fail); the absent/empty split, so
  a 0-byte object is read as evidence AGAINST a systemic fault rather than for
  one; and the new direct tests for rotate() and the withTimeout around
  headObjectMeta.

HOW IT WAS DISCHARGED: two agents reviewed it independently — Cursor and Codex,
  each from its own cold orientation pass over the repo, neither holding the
  other's conclusion — and converged on the same reading: correct as written,
  safe to build on, residual risks unchanged from the list above. The author had
  already mutation-checked both Importants by hand (revert the write-budget
  reservation and exactly the new test fails; force a C1 truncation under
  CONCURRENCY=1 and the absent job is still reported held, and reverting the
  gate's corroborationIncomplete check flips held back to 0).

WHAT THIS DOES NOT MEAN. Recorded deliberately, because "reviewed" is exactly
  the word this repo has been burned by six times:
  - It is NOT production validation. Three readings of the same code agree only
    that the code says what it means to say. Every RESIDUAL RISK bullet above
    stands unreduced — no Supabase timeout, no heartbeat, rotate() bounding
    rather than draining starvation, and two thresholds with no production data
    behind them.
  - NOTHING in this pipeline has executed against real AWS. One real master
    through the real pipeline is still the gate, and review does not move it.
  - The s3:ListBucket ORDERING CONSTRAINT is untouched and still in force: the
    grant must not reach production ahead of this code, because it is what turns
    a harmlessly-retried 403 into a permanent, irreversible fail. The
    corroboration gate reviewed here is what makes the grant safe — which is the
    reason they ship together, not a reason either has been exercised.

=== PROPOSED, NOT BUILT — heartbeat persistence (future founder decision) ===
PROVENANCE: written during T5 fix round 1 (item 5) and corrected in fix round 2,
  and until now it lived only in `.superpowers/sdd/2026-08-06-screener-proxy/
  task-5-report.md` — a GITIGNORED scratch file, i.e. nowhere a new reader would
  ever find it. Promoted here verbatim so the record survives; promotion is not
  approval.

STATUS: NOT BUILT. No migration exists and none may be written for it in this
  slice. It is a SEPARATE observability slice and a FUTURE founder-approved
  schema change. Do not fold it into T6.

WHY IT IS NOT A T6 DEPENDENCY: T6's panel derives stuck state from
  transcode_jobs.status + created_at, which ages correctly whether or not the
  poll ever ran — so the panel is not blocked on this. What the panel cannot do
  is say WHICH thing stopped: a stopped cron and a stalled MediaConvert job
  produce an identical aging row. A heartbeat separates those two, and only
  those two. That is a real gap and a real limitation, but it is not T6's.

THE CORRECTION fix round 2 made to the original proposal, kept because the
  reasoning is the reusable part: the first draft gated the read on a bare
  `is_gc_staff(auth.uid())`, when every GC-scoped read policy since
  20260727000100 uses `public.gc_can(auth.uid(), 'view')` — 20260802000200
  exists specifically to ELIMINATE bare is_gc_staff gating, so reintroducing it
  would be the exact pattern that migration was written to remove. It also gave
  service_role a direct `insert, update` grant, contradicting the
  revoke-all-plus-RPC convention 20260807000100 spent two fix rounds
  establishing for transcode_jobs itself. A SECURITY DEFINER RPC runs as its
  owner regardless of the caller's grants, so service_role never needs a direct
  table write for the call to work.

PROPOSED SHAPE (not applied, not approved — do not run this):

  create table public.cron_heartbeats (
    job_name    text primary key,
    last_run_at timestamptz not null,
    summary     jsonb not null default '{}'::jsonb
  );
  revoke all on public.cron_heartbeats from anon, authenticated, service_role;
  grant select on public.cron_heartbeats to authenticated;   -- gc_can-gated below
  alter table public.cron_heartbeats enable row level security;
  create policy cron_heartbeats_select on public.cron_heartbeats for select to authenticated
    using (public.gc_can(auth.uid(), 'view'));

  create or replace function public.record_poll_heartbeat(p_job_name text, p_summary jsonb default null)
    returns void language plpgsql security definer set search_path = public as $$
  begin
    insert into public.cron_heartbeats (job_name, last_run_at, summary)
    values (btrim(p_job_name), now(), coalesce(p_summary, '{}'::jsonb))
    on conflict (job_name) do update set last_run_at = excluded.last_run_at, summary = excluded.summary;
  end; $$;
  revoke execute on function public.record_poll_heartbeat(text, jsonb) from public, anon, authenticated;
  grant  execute on function public.record_poll_heartbeat(text, jsonb) to service_role;

  The route would call record_poll_heartbeat('transcode-poll', <summary jsonb>)
  at the END of every invocation, success or partial failure alike — the point
  is "did it run," not "did it succeed." A panel then reads last_run_at: if
  now() - last_run_at exceeds a couple of scheduled intervals, it can say the
  poll has not run, which is the failure mode a per-invocation JSON response
  structurally cannot report.

  Note the `p_summary jsonb default null` — required, not stylistic. Without
  DEFAULT null the type generator marks the argument required non-null and the
  omitted-argument call site fails to compile. That has bitten five times; see
  CLAUDE.md's Known Gotchas.

=== T6 EXECUTION DECOMPOSITION — 2026-08-07, scope unchanged ===
T6 executes as two commits along the Step 1 / Step 2 boundary the plan already
  draws: 6A is the read-only panel, 6B is the retry mutation. NOT a scope change
  and NOT a deferral — 6B is the second half of T6, and T6 is not done until both
  have shipped. The plan's Task 6 Step 3 was amended to two commits, which was the
  narrowest edit that removed the contradiction.
WHY: the halves fail differently. 6A is a bounded read plus a derived display
  value. 6B submits to AWS, writes a job row, and has to get retry eligibility
  and the GC-operate gate right — including that the partial unique index
  transcode_jobs_active_key_uidx makes retrying an already-`complete` job a
  UNIQUE CONSTRAINT VIOLATION rather than a no-op, because the retry would carry
  the same expected_output_key. Reviewed next to table markup, that is the half
  that gets skimmed.

=== Proxy T6A: complete — MERGED to main 2026-08-07 as PR #93 ===
Reviewed implementation commit: 0f4ed6360f45075d8becedd7efbb8f48f3a1cbc7
  (merge commit 0c778eb). Cursor implementation; independent Codex re-review
  found no remaining findings before merge.

DELIVERED (read-only; no mutation):
  - Bounded, title-scoped transcode_jobs read on the GC title page, inside the
    existing Promise.all (DETAIL_LIST / rangeFor).
  - Panel shows status, created time, failure reason, and output screener
    (filename or short asset id).
  - Derived Stuck state for active jobs (submitted|running) when created_at is
    strictly older than 60 minutes — same inequality as the poll. No heartbeat
    table and no heartbeat dependency.
  - Invalid created_at fails closed to an em dash (never "Invalid Date").
  - Approved copy centralized in src/lib/transcode-jobs.ts.
  - No retry control; no schema/migrations/RPCs; no AWS/Vercel/dependency changes.

VALIDATION (run, not read): typecheck clean; 318 Vitest tests; eslint 0 errors /
  5 known warnings; build success. Required isolation check passed; Vercel
  passed; checks remained red only on the documented pre-existing js-yaml /
  nanoid dependency audit.

=== Proxy T6B: complete — MERGED to main 2026-08-07 as PR #95 ===
Reviewed implementation commit: 0f4b07aa2b20b66557bec2fae0bf309dfb007f19
  (merge commit a63c1c7). Cursor implementation; independent Codex re-review
  approved with minor non-blocking notes before merge.

DELIVERED (mutation; no schema/RPC/RLS/AWS-infra changes):
  - Retry only for failed / submit_failed (never submitted / running / complete).
  - Pre-AWS gc_can(operate) safety gate after getAuthUser(); fail closed.
  - create_transcode_job / member_can(operate) remains the DB write boundary.
  - Client supplies only titleId + jobId; org/title/source/master key/expected
    output key/MediaConvert args derived from server-read state.
  - Sequence: trusted read → submitProxyJob → create_transcode_job (new row) →
    revalidate only on successful recording. Old job untouched.
  - Explicit failure copy: AWS submit failure; split-brain record failure /
    rejection / unknown; exact transcode_jobs_active_key_uidx conflict only.
  - Panel Retry affordance gated by canRetry && eligibility; pending disables
    ordinary repeat clicks on the mounted control.

VALIDATION (run, not read): typecheck clean; 356 Vitest tests; eslint 0 errors /
  5 known warnings; build success. Required isolation check passed; Vercel
  passed; checks remained red only on the documented pre-existing js-yaml /
  nanoid dependency audit.

TASK 6 COMPLETE (6A + 6B). Next slice is Task 7.

=== Proxy T6B — FOUNDER-ACCEPTED RESIDUAL (concurrent retry), 2026-08-07 ===
STATUS: ACCEPTED RESIDUAL — remains open/documented. Not resolved by 6B merge.
  No mitigation was added and none should be backfilled into this slice.

ARCHITECTURE: retry follows the approved AWS-submit-before-record path
  (same as master upload): `submitProxyJob` then `create_transcode_job`.
  The UI pending state on the mounted Retry control prevents ordinary
  repeated clicks on that control. It does NOT serialize cross-tab,
  cross-operator, or direct concurrent calls.

RACE: two concurrent retries can both pass eligibility and both submit
  paid MediaConvert jobs before either insert claims the output key.
  `transcode_jobs_active_key_uidx` ensures only one active/complete DB row
  wins for a given expected_output_key; the loser surfaces the conflict or
  split-brain record-failure copy and may leave an orphan AWS job.
  The poll cannot discover orphans (it only reads `transcode_jobs` rows).

EXPLICITLY NOT ADDED in 6B: compensation, AWS cleanup, locking,
  claim/reservation rows, new schema, migrations, or RPCs. Future mitigation
  would require architectural/schema/claim/locking work outside this slice.

NON-BLOCKING NOTE (accepted for 6B; future refinement): `transcode-panel.tsx`
  is a full-panel client component for Retry pending state. A server panel +
  client Retry island would be narrower; not refactored before merge.

=== Proxy T7: complete — documentation/governance (uncommitted pending review) ===
DATE: 2026-08-07. Docs/governance only; no application code, schema, RPC, RLS,
  AWS/Vercel, dependency, CI, or production-state change.

DELIVERED:
  - domain-spec §12: general-purpose / delivery transcoding remains out of scope;
    design-spec §3 “Exception — internal viewing proxies” added; client master
    remains delivery/source; H.264 proxy is viewing derivative only.
  - domain-spec later “out of scope entirely” line: same narrow exception;
    explicitly excludes platform delivery encoding, mezzanine/master prep,
    client-requested format conversion, arbitrary derivatives.
  - CLAUDE.md + AGENTS.md deferred lists: materially aligned — absolute
    “GC never transcodes” replaced; viewing screener proxies noted as built
    §12 exception; do not broaden.
  - HANDOFF / plan / ledger: Task 6 complete bookkeeping retained; Task 7
    marked done; next slice Task 8.

NOT TOUCHED (intentionally — non-governing historical / open issues preserved):
  - Historical design notes that once said “GC never transcodes” (e.g. older
    superpowers specs) left as period documents.
  - Production migration drift, real-AWS validation, s3:ListBucket ordering,
    unnamed-link finding, revoke_portal_link founder call, concurrent-retry
    residual, heartbeat debt, architectural/test debt, Task 8 backfill.

=== Proxy T8: runbook complete — documentation only (uncommitted pending review) ===
DATE: 2026-08-07. Created docs/infra/screener-proxy-backfill.md.

DELIVERED (docs only):
  - Founder-only execution warning; no agent migrations/psql/AWS/spend.
  - Preconditions: prod migrations, deploy, AWS/IAM, ListBucket ordering, cron.
  - Canary procedure + PASS/FAIL; STOP on FAIL.
  - Eligibility: current master = newest kind=master by created_at per title
    (portal_resolve_screener / transcode_jobs migration evidence); skip if
    active/complete job holds deterministic screener key; dedicated titles
    eligible for proxy register without screener_source override.
  - Glacier/unrestored excluded from initial cohort (deferred separate procedure).
  - Future founder TS script requirements (dry-run, batching, submit→record);
    script NOT created in this slice.
  - Rollout: canary 1 → pilot 5–10 → controlled batches; no full-catalog wave.
  - Stop conditions, split-brain, retry rules, prohibited actions, checkpoints.

CODEX FINDINGS FIX (same day, docs only):
  1. Canary sequencing: §2a before canary submit; §2b one controlled canary spend
     before C2; §2c C2+stops+founder+S1 before pilot. No circular “PASS before canary.”
  2. M1: non-mutating verification only — no create_transcode_job smoke.
  3. Submission governance: interim operate path removed. Pilot/batch require §13a
     script (not built). Canary may use POST /api/assets/complete only; virgin
     pre-existing-master canary without upload-complete is blocked until script.
  4. C2 PASS requires GC panel AND mandatory buyer gated playback.
  5. Reconciled setup vs backfill: screener-proxy-setup.md legacy CLI create-job is
     NOT Task 8 production E2E validation; A1 uses infra/non-submitting checks only;
     C2 canary is the sole Task 8 end-to-end path. Setup IAM/queue/env steps intact.
  6. Removed setup phrasing “or an equivalently governed app-path job” — no alternate
     Task 8 production E2E path; C2 sole gate; no CLI/console/interim substitute.

NOT DONE (explicit):
  - Founder execution of backfill
  - Production canary
  - Migration apply
  - AWS runbook apply/verify
  - TypeScript backfill script (blocks pilot/batch; S1)
  - Production validation claim

NEXT: Founder review of the corrected runbook → commit/PR docs → founder
  M1/D1/A1/C0/C1 then one canary spend → C2 (GC+buyer) → S1 script slice →
  pilot. Do not spend from the agent.

=== UNNAMED-LINK BYPASS — Option D remediation (2026-08-08) ===
FOUNDER: rejected shipping the bypass as a production residual. M1 apply BLOCKED
until this fix is merged to main and included in the production migration plan.

CHOSEN: Option D — Layer A stream gate + Layer B narrow RLS.
Migrations (additive; do not amend 003):
  20260808000100_hide_gc_unnamed_screener_links.sql
  20260808000200_portal_resolve_screener_asset_kind.sql  — TOCTOU close: RPC returns
    asset_kind; /api/portal/screener authorizes on resolved asset, not a second
    titles.screener_source read.

INTENTIONAL: pre-proxy GC portal master review via unnamed links is removed.
GC portal review resumes when a dedicated screener exists or proxy registers one.
No in-dashboard master player in this slice. Master download unchanged.

REQUIRED M1 ORDERING (STOP): merge remediations → deploy NEW app first → verify
fail-closed portal gate → fresh drift/preflight → founder applies all NINE
migrations in timestamp order → non-mutating verify → then D1/A1.
Do NOT begin the nine-migration prod apply while the OLD app is serving traffic
(003 under old app can expose GC unnamed tokens + old master-stream exemption).
Brief dedicated-playback outage before 080002 is acceptable; master stream reopen
is not.

SEPARATE / STILL OPEN: revoke_portal_link title-status gate (not in this slice).

B3: updated to assert clients see named own-title tokens only — never park in
KNOWN_OPEN.

LOCAL MIGRATION DEVIATION: Cursor ran `supabase migration up --local` for
20260808000100 during implementation. No production change. Local DB is
NON-AUTHORITATIVE for migration evidence. Cursor-reported local pgTAP /
policy-mutation results are not independently reproduced under current
governance. Agents must not run migrations — rule unchanged.
