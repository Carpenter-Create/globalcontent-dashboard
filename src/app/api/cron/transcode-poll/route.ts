import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getJob } from "@/lib/mediaconvert";
import { headObjectMeta } from "@/lib/s3";
import { probeRange, splitProbe, UNPAGINATED_MAX } from "@/lib/list-bounds";
import { resolveJobOutcome } from "@/lib/transcode-poll";

// This is the first scheduled job in this codebase (see vercel.json and
// docs/scheduled/subscription-lifecycle.md, which documents the absence and names this route
// as what the eventual subscription-lapse cron should shape itself after — one `crons` array,
// one auth pattern, not a second scheduling mechanism).
//
// Replaces an earlier design where AWS pushed a completion event to a public endpoint. The
// founder chose polling specifically to avoid a public write surface — this route must never
// become one. Only Vercel's own cron dispatcher, authenticated below, may trigger it.
//
// TWO PLATFORM FACTS WORTH STATING HERE, not just in the runbook, because they change what
// "this route never ran" MEANS when diagnosing an incident:
//   1. `*/5 * * * *` (minute-level granularity) requires the account be on Vercel Pro or
//      above — Hobby crons are limited to once per day. If this ever silently reverts to a
//      daily schedule, that is a plan downgrade, not a code regression.
//   2. Vercel only invokes crons against PRODUCTION deployments. This route is never
//      exercised by a preview deploy, however thoroughly that preview is otherwise tested —
//      "the preview looks fine" says nothing about whether the cron is wired up at all.
//
// ORDERING NOTE (fix round 2): docs/infra/screener-proxy-setup.md's `s3:ListBucket` grant
// (fix round 1, item 1) must NOT be applied to the production IAM policy before THIS file's
// fleet-wide corroboration gate (below) and per-call timeouts are deployed. Granting
// ListBucket alone flips a missing-object 404 from "cannot tell" (403, retried forever,
// wasteful but harmless) to "confirmed absent" (permanent, irreversible fail_transcode_job on
// first observation) — safe ONLY because this file now refuses to act on that confirmation
// when it looks fleet-wide rather than individual. Ship the grant and this file's logic
// together, never the grant alone.

// Fix round 1, item 6 / fix round 2, item 3: up to UNPAGINATED_MAX jobs, each needing up to
// two sequential AWS round-trips, run on a 5-minute schedule with no deadline or per-call
// ceiling would eventually get killed mid-invocation by the platform's own function timeout —
// silently dropping the summary log, the stuck-jobs warning, and the deferred count.
// `maxDuration` gives the platform ceiling; POLL_TIME_BUDGET_MS is checked BETWEEN batches so
// the route can stop ITSELF cleanly; PER_CALL_TIMEOUT_MS (below, applied via `withTimeout`) is
// what makes that between-batch check actually able to bind — a between-batch check alone
// cannot stop a single hanging call from carrying the whole invocation past `maxDuration`, so
// every AWS call this route makes is raced against its own ceiling independently of whatever
// the SDK clients are configured to do internally (see s3.ts/mediaconvert.ts for the
// client-level timeouts, which are the first line of defense; this is the backstop).
export const maxDuration = 60;
const POLL_TIME_BUDGET_MS = 35_000;
const PER_CALL_TIMEOUT_MS = 10_000;

// Bounded concurrency, not strictly serial: GetJob/HeadObject are I/O-bound round-trips, and
// running a handful at once is what actually keeps a real backlog inside the time budget
// above. Small on purpose — this is a background job against two AWS services with their own
// throttling, not a place to maximize throughput.
const CONCURRENCY = 10;

// Fix round 2, item 4 (head-of-queue starvation): the DB read below still orders by
// created_at ascending — that's still correct for what gets FETCHED (the oldest 500, so an
// old backlog is never invisible behind a newer flood). But fix round 1's comment claiming
// this was "handled" was wrong: if the same head-of-queue job(s) always hang or error, they
// consume the processing budget every single tick, and everything behind them is deferred
// FOREVER, never once reaching the front. ROTATE the in-memory processing order instead of
// the query: `epoch` advances once per scheduled tick (assuming the */5 schedule), so a
// different job is "first" each time. Given enough ticks, every job's turn eventually falls
// early enough in a run to be attempted, rather than the same unlucky head owning 100% of the
// budget indefinitely.
const TICK_INTERVAL_MS = 5 * 60 * 1000;

// Takes `now` as a parameter rather than calling Date.now() itself: the caller already takes
// one wall-clock reading to compute the shared deadline, and reusing it here (a) keeps
// rotation and the deadline computed from the SAME instant rather than two independently
// racy reads, and (b) keeps this function a pure, directly testable one.
function rotate<T>(items: T[], now: number): T[] {
  if (items.length === 0) return items;
  const epoch = Math.floor(now / TICK_INTERVAL_MS);
  const offset = epoch % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

// A transcode already takes minutes; every real transcode this pipeline will ever run
// finishes in well under an hour. 60 minutes is comfortably longer than that plus several
// missed 5-minute ticks, so a job still open past it is a genuine signal something stalled
// (a paused scheduler, an AWS-side problem, a bug here) rather than normal latency.
//
// Fix round 1, item 5 — WHAT THIS COUNT IS AND ISN'T: it is a per-invocation diagnostic,
// logged and returned in this response, and nothing more. It is NOT persisted, and a count
// only this route can see cannot report the one failure mode that matters most: the route
// never running at all (CRON_SECRET unset, vercel.json lost in a merge, the deployment never
// promoted to production). Task 6's panel must compute staleness itself, straight from
// `transcode_jobs.status` + `created_at` — data that exists independent of whether this route
// has run recently — rather than trust a number this route produced. Persisting an actual
// heartbeat needs a new table; that is a schema change and is out of scope for this fix round
// (founder-approved migrations only) — see the task report for the proposed shape.
const STUCK_THRESHOLD_MS = 60 * 60 * 1000;

// Fix round 2, item 4 (allErrored hair trigger): a single selected job hitting a transient
// blip made `errored === jobs.length` true whenever there was only one job in flight,
// returning 503 for what is statistically noise, not a signal. Require a minimum sample
// before treating "every job errored" as a total-outage alarm rather than an individual blip
// — below this floor, the per-job errors are still logged and still visible in the JSON body,
// just not escalated to the one signal Vercel itself surfaces (the HTTP status).
const TOTAL_FAILURE_FLOOR = 3;

function isAuthorized(req: Request): boolean {
  // Refuse outright if the secret isn't configured — never fail open into a poll anyone can
  // trigger by hitting the route with no header at all.
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length);

  // Timing-safe: a plain `!==` string compare leaks length and content through response
  // timing. timingSafeEqual requires equal-length buffers, so unequal lengths are rejected
  // before ever reaching it — they cannot be equal, and comparing them would throw.
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Races an AWS call against its own ceiling so a single hang can never consume more than
// PER_CALL_TIMEOUT_MS of the shared budget, independent of whatever the SDK client's own
// requestHandler/maxAttempts configuration does underneath (see s3.ts/mediaconvert.ts). This
// does not cancel the underlying network call — Node has no way to abort a bare Promise — it
// only stops THIS invocation from waiting on it further; the abandoned call resolves or
// rejects later into nothing, which is safe here because no write happens until a result is
// in hand.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

interface InFlightJob {
  id: string;
  external_job_id: string | null;
  expected_output_key: string;
  created_at: string;
}

type AdminClient = ReturnType<typeof createAdminClient>;
type JobOutcome = "completed" | "failed" | "alreadyResolved" | "errored";

// Generic bounded-concurrency, time-budgeted batch runner shared by every phase below (AWS
// status checks, object-presence checks, and DB writes alike) so the deadline and concurrency
// behavior is defined exactly once rather than reimplemented per phase.
async function runBatched<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  deadline: number,
  phaseLabel: string,
): Promise<{ results: R[]; deferred: T[] }> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    if (Date.now() > deadline) {
      const remaining = items.slice(i);
      console.warn(
        `[transcode:poll] time budget exceeded during ${phaseLabel} — deferring ${remaining.length} item(s) to the next tick`,
      );
      return { results, deferred: remaining };
    }
    const batch = items.slice(i, i + CONCURRENCY);
    // Every worker used below catches its own errors and never rejects, so Promise.all here
    // cannot short-circuit on one item's failure.
    const batchResults = await Promise.all(batch.map(worker));
    results.push(...batchResults);
  }
  return { results, deferred: [] };
}

// Peeks the job's CURRENT status immediately before writing, so an overlapping poll run that
// already resolved this job is recognised as a no-op rather than misreported. Fix round 1,
// items 5(reporting)/7: replaced regex-matching fail_transcode_job's error text (which could
// not distinguish "already complete" from "genuinely not found" — the RPC raises the
// identical message for both) with a direct read of the row's own status. If the row is
// already terminal, skip the RPC entirely (no wasted call, no ambiguity to guess at). If the
// peek itself fails or the row is still active, fall through to the original write — the
// RPC's own row lock and idempotency (Task 2) remain the actual correctness guarantee; this
// is a reporting-accuracy read, not a second lock.
async function alreadyTerminal(supabase: AdminClient, jobId: string): Promise<boolean> {
  const { data, error } = await supabase.from("transcode_jobs").select("status").eq("id", jobId).maybeSingle();
  if (error || !data) return false;
  return data.status !== "submitted" && data.status !== "running";
}

// ---------------------------------------------------------------------------------------
// PHASE A — resolve what MediaConvert says about each in-flight job. No writes here.
// ---------------------------------------------------------------------------------------
type AwsPhaseResult =
  | { kind: "stillRunning" }
  | { kind: "erroredChecking" }
  | { kind: "awsFailed"; job: InFlightJob; reason: string }
  | { kind: "awsComplete"; job: InFlightJob };

async function resolveAwsPhase(job: InFlightJob): Promise<AwsPhaseResult> {
  if (!job.external_job_id) {
    // Nothing to check against AWS for a job with no recorded external id (a submission that
    // failed before MediaConvert returned one). Leave it — it still counts toward the stuck
    // signal if it's old enough.
    return { kind: "stillRunning" };
  }

  let awsStatus: { status: string; errorMessage: string | null };
  try {
    awsStatus = await withTimeout(getJob(job.external_job_id), PER_CALL_TIMEOUT_MS, `GetJob(${job.id})`);
  } catch (e) {
    // GetJob failed (or timed out) — an AWS/network hiccup, not evidence the transcode
    // failed. Leave the job for the next tick.
    console.error(`[transcode:poll] GetJob failed for ${job.id}: ${e instanceof Error ? e.message : e}`);
    return { kind: "erroredChecking" };
  }

  const outcome = resolveJobOutcome(awsStatus.status);
  if (outcome === null) return { kind: "stillRunning" };
  if (outcome === "failed") {
    return {
      kind: "awsFailed",
      job,
      reason: awsStatus.errorMessage ?? `MediaConvert reported ${awsStatus.status}`,
    };
  }
  return { kind: "awsComplete", job };
}

// ---------------------------------------------------------------------------------------
// PHASE C1 — verify the output object for every AWS-reported COMPLETE job. No writes here
// either: the fleet-wide corroboration gate needs to see every result before any of them are
// acted on.
// ---------------------------------------------------------------------------------------
type ObjectCheckResult =
  | { kind: "present"; job: InFlightJob; meta: { bytes: number; etag: string } }
  | { kind: "missing"; job: InFlightJob; reason: string }
  | { kind: "erroredChecking" };

async function checkObject(job: InFlightJob): Promise<ObjectCheckResult> {
  let meta: { bytes: number; etag: string } | null;
  try {
    meta = await withTimeout(headObjectMeta(job.expected_output_key), PER_CALL_TIMEOUT_MS, `HeadObject(${job.id})`);
  } catch (e) {
    // Not a confirmed-absent NotFound (network, throttling, permissions, or — per s3.ts's own
    // HeadBucket disambiguation — a bucket that is itself unreachable) is "we could not
    // tell," not "the object is missing." Do not fail the job on that basis.
    console.error(`[transcode:poll] HeadObject failed for ${job.id}: ${e instanceof Error ? e.message : e}`);
    return { kind: "erroredChecking" };
  }

  // Fix round 1, item 7: a 0-byte object is not a viewable screener — treated identically to
  // a missing one.
  if (!meta || meta.bytes === 0) {
    const reason = !meta
      ? "MediaConvert reported COMPLETE but the output object was not found in S3"
      : "MediaConvert reported COMPLETE but the output object is 0 bytes";
    return { kind: "missing", job, reason };
  }
  return { kind: "present", job, meta };
}

// ---------------------------------------------------------------------------------------
// PHASE B / C3 — the only place either RPC is actually called.
// ---------------------------------------------------------------------------------------
type WriteTask =
  | { action: "register"; job: InFlightJob; meta: { bytes: number; etag: string } }
  | { action: "fail"; job: InFlightJob; reason: string };

async function performWrite(supabase: AdminClient, task: WriteTask): Promise<{ id: string; outcome: JobOutcome }> {
  if (await alreadyTerminal(supabase, task.job.id)) {
    return { id: task.job.id, outcome: "alreadyResolved" };
  }

  if (task.action === "register") {
    // The key passed here is the JOB'S OWN recorded expected_output_key — never one derived
    // or taken from AWS/S3 — exactly as register_transcode_output's key-match check requires.
    const { error } = await supabase.rpc("register_transcode_output", {
      p_job_id: task.job.id,
      p_storage_key: task.job.expected_output_key,
      p_bytes: task.meta.bytes,
      p_content_hash: task.meta.etag,
    });
    if (error) {
      console.error(`[transcode:poll] register_transcode_output error for ${task.job.id}: ${error.message}`);
      return { id: task.job.id, outcome: "errored" };
    }
    return { id: task.job.id, outcome: "completed" };
  }

  const { error } = await supabase.rpc("fail_transcode_job", { p_job_id: task.job.id, p_reason: task.reason });
  if (error) {
    console.error(`[transcode:poll] fail_transcode_job error for ${task.job.id}: ${error.message}`);
    return { id: task.job.id, outcome: "errored" };
  }
  return { id: task.job.id, outcome: "failed" };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Bounded per @/lib/list-bounds — same pattern every other list read in this repo uses
  // since a092250. UNPAGINATED_MAX (500) is the house ceiling for a read that hasn't been
  // paginated yet; a backlog of 500+ in-flight jobs is itself the stuck-jobs signal below
  // firing loudly long before this bound would ever bite in practice. Still ordered by
  // created_at ascending so the OLDEST jobs are always what gets fetched when the backlog
  // exceeds the cap — rotation (below) only changes PROCESSING order within what was fetched.
  const [from, to] = probeRange(UNPAGINATED_MAX);
  const { data, error: selectError } = await supabase
    .from("transcode_jobs")
    .select("id, external_job_id, expected_output_key, created_at")
    .in("status", ["submitted", "running"])
    .order("created_at", { ascending: true })
    .range(from, to);

  if (selectError) {
    console.error(`[transcode:poll] could not read in-flight jobs: ${selectError.message}`);
    return NextResponse.json({ error: "Could not read jobs" }, { status: 500 });
  }

  const { rows: jobs, truncated } = splitProbe(data as InFlightJob[] | null, UNPAGINATED_MAX);
  if (truncated) {
    console.warn(
      `[transcode:poll] job selection truncated at ${UNPAGINATED_MAX} — the in-flight backlog is larger than one page`,
    );
  }

  let completed = 0;
  let failed = 0;
  let stillRunning = 0;
  let errored = 0;
  let alreadyResolved = 0;
  let deferred = 0;
  // Fix round 2, item 1: jobs a COMPLETE-but-missing-object outcome would otherwise have
  // permanently failed, HELD BACK because the absence looked fleet-wide rather than
  // individual this tick. Never written to; they stay exactly as open as before.
  let held = 0;

  const stillOpen = new Set(jobs.map((j) => j.id));
  const now = Date.now();
  const deadline = now + POLL_TIME_BUDGET_MS;

  // ---- PHASE A: ask MediaConvert about every rotated, in-flight job -------------------
  const rotatedJobs = rotate(jobs, now);
  const { results: awsResults, deferred: deferredA } = await runBatched(
    rotatedJobs,
    resolveAwsPhase,
    deadline,
    "phase A (GetJob)",
  );
  deferred += deferredA.length;

  const awsFailedJobs: { job: InFlightJob; reason: string }[] = [];
  const awsCompleteJobs: InFlightJob[] = [];
  for (const r of awsResults) {
    if (r.kind === "stillRunning") stillRunning++;
    else if (r.kind === "erroredChecking") errored++;
    else if (r.kind === "awsFailed") awsFailedJobs.push({ job: r.job, reason: r.reason });
    else awsCompleteJobs.push(r.job);
  }

  // ---- PHASE C1: verify the output object for every COMPLETE job, before writing anything ---
  const { results: checkResults, deferred: deferredC1 } = await runBatched(
    awsCompleteJobs,
    checkObject,
    deadline,
    "phase C1 (HeadObject)",
  );
  deferred += deferredC1.length;

  const presentResults: { job: InFlightJob; meta: { bytes: number; etag: string } }[] = [];
  const missingResults: { job: InFlightJob; reason: string }[] = [];
  for (const r of checkResults) {
    if (r.kind === "erroredChecking") errored++;
    else if (r.kind === "present") presentResults.push({ job: r.job, meta: r.meta });
    else missingResults.push({ job: r.job, reason: r.reason });
  }

  // ---- FLEET-WIDE CORROBORATION GATE (fix round 2, item 1) ----------------------------
  // Granting s3:ListBucket (fix round 1, item 1) means a missing output object now resolves
  // as a confirmed 404, not an ambiguous 403 — and fail_transcode_job is permanent and
  // irreversible (rule 2: no deletes; register_transcode_output refuses a non-active job).
  // A systemic cause (a set-but-wrong S3_BUCKET, a proxyOutputKey/MediaConvert drift, a
  // bucket rename) would otherwise fail the ENTIRE checked cohort in one tick.
  //
  // CHOSEN APPROACH: corroboration within the tick, not a persisted grace window. A grace
  // window needs somewhere to record "first observed missing at T" that survives across
  // invocations, and every column on transcode_jobs that could hold that is already spoken
  // for (status transitions immediately; there is no schema change available this round to
  // add one). Within-tick corroboration needs no new state at all: if MORE THAN ONE job
  // resolved to AWS-COMPLETE this tick and EVERY one of them reports its output missing, that
  // is a configuration fault, not N independent transcode failures, and none of them are
  // permanently failed on that basis — held back instead, for the next tick to re-evaluate
  // fresh. A SINGLE complete-but-missing job (nothing to corroborate against) still fails
  // normally, exactly as before this fix round.
  const completeTotal = presentResults.length + missingResults.length;
  const systemicAbsence = completeTotal > 1 && missingResults.length === completeTotal;

  if (systemicAbsence) {
    held += missingResults.length;
    console.error(
      `[transcode:poll] SYSTEMIC ABSENCE — all ${missingResults.length} COMPLETE job(s) checked this tick ` +
        `reported a missing/empty output object. Refusing to permanently fail any of them — this looks like ` +
        `a configuration fault (S3_BUCKET, proxyOutputKey drift, a bucket rename), not independent transcode ` +
        `failures. Held job ids: ${missingResults.map((r) => r.job.id).join(", ")}`,
    );
  }

  // ---- PHASE B / C3: the only writes in this route ------------------------------------
  const writeTasks: WriteTask[] = [
    ...awsFailedJobs.map(({ job, reason }): WriteTask => ({ action: "fail", job, reason })),
    ...presentResults.map(({ job, meta }): WriteTask => ({ action: "register", job, meta })),
    ...(systemicAbsence ? [] : missingResults.map(({ job, reason }): WriteTask => ({ action: "fail", job, reason }))),
  ];

  const { results: writeResults, deferred: deferredWrites } = await runBatched(
    writeTasks,
    (task) => performWrite(supabase, task),
    deadline,
    "phase B/C3 (writes)",
  );
  deferred += deferredWrites.length;

  for (const { id, outcome } of writeResults) {
    switch (outcome) {
      case "completed":
        completed++;
        stillOpen.delete(id);
        break;
      case "failed":
        failed++;
        stillOpen.delete(id);
        break;
      case "alreadyResolved":
        alreadyResolved++;
        stillOpen.delete(id);
        break;
      case "errored":
        errored++;
        break;
    }
  }

  const stuckCutoff = Date.now() - STUCK_THRESHOLD_MS;
  const stuck = jobs.filter((j) => stillOpen.has(j.id) && new Date(j.created_at).getTime() < stuckCutoff).length;
  if (stuck > 0) {
    console.warn(`[transcode:stuck] ${stuck} job(s) older than 60m still in flight`);
  }

  // Fix round 1, item 5 / fix round 2, item 4: the one thing Vercel itself surfaces (an
  // invocation's HTTP status) must not stay green through a total AWS outage, but a single
  // job's transient blip must not trip it either — TOTAL_FAILURE_FLOOR requires a real sample
  // before "every job errored" is escalated. A fleet-wide absence hold is ALWAYS surfaced
  // regardless of sample size — it's a definite finding (every complete job this tick was
  // missing its output), not a noisy rate.
  const allErrored = jobs.length >= TOTAL_FAILURE_FLOOR && errored === jobs.length;
  const unhealthy = allErrored || held > 0;

  return NextResponse.json(
    {
      checked: jobs.length,
      completed,
      failed,
      stillRunning,
      errored,
      alreadyResolved,
      deferred,
      held,
      truncated,
      stuck,
    },
    { status: unhealthy ? 503 : 200 },
  );
}
