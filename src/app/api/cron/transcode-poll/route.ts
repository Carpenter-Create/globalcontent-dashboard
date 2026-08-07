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

// Fix round 1, item 6: up to UNPAGINATED_MAX jobs, each needing up to two sequential AWS
// round-trips, run on a 5-minute schedule with no deadline check would eventually get killed
// mid-invocation by the platform's own function timeout — silently dropping the summary log,
// the stuck-jobs warning, and (worse) re-polling the same head-of-queue jobs every tick while
// newer ones behind them never get checked at all, since the read orders by created_at
// ascending. `maxDuration` gives the platform ceiling; POLL_TIME_BUDGET_MS is comfortably
// under it so the route can stop ITSELF cleanly — finish the in-flight batch, report how many
// jobs were left unattempted, and let the next tick pick them up — rather than being cut off
// mid-response with nothing recorded.
export const maxDuration = 60;
const POLL_TIME_BUDGET_MS = 50_000;

// Bounded concurrency, not strictly serial: GetJob/HeadObject are I/O-bound round-trips, and
// running a handful at once is what actually keeps a real backlog inside the time budget
// above (a serial loop over even 50 in-flight jobs at ~1s per pair of AWS calls would already
// eat most of the budget). Small on purpose — this is a background job against two AWS
// services with their own throttling, not a place to maximize throughput.
const CONCURRENCY = 10;

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
// heartbeat (a `last_poll_at` row this route upserts, so the PANEL can also detect "the poll
// hasn't run in N ticks") needs a new table; that is a schema change and is out of scope for
// this fix round (founder-approved migrations only) — see the task report for the proposed
// shape.
const STUCK_THRESHOLD_MS = 60 * 60 * 1000;

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

interface InFlightJob {
  id: string;
  external_job_id: string | null;
  expected_output_key: string;
  created_at: string;
}

type AdminClient = ReturnType<typeof createAdminClient>;

type JobResult = {
  id: string;
  outcome: "completed" | "failed" | "stillRunning" | "errored" | "alreadyResolved";
};

// Peeks the job's CURRENT status immediately before writing, so an overlapping poll run that
// already resolved this job is recognised as a no-op rather than misreported. Fix round 1,
// items 5(reporting)/7: the previous version inferred "a concurrent run already handled this"
// by regex-matching fail_transcode_job's error text (`/already complete/i`), which is the
// SAME string the RPC raises for a genuinely non-existent job id — no distinction was
// possible from the message alone. It also had no equivalent for the register path, where an
// idempotent no-op return was silently counted as a fresh registration, inflating `completed`.
// This single check fixes both: if the row is already terminal, skip the RPC entirely (no
// wasted call, no ambiguity to guess at). If the peek itself fails or the row is still
// active, fall through to the original write — the RPC's own row lock and idempotency
// (Task 2) remain the actual correctness guarantee; this is a reporting-accuracy read, not a
// second lock.
async function alreadyTerminal(supabase: AdminClient, jobId: string): Promise<boolean> {
  const { data, error } = await supabase.from("transcode_jobs").select("status").eq("id", jobId).maybeSingle();
  if (error || !data) return false;
  return data.status !== "submitted" && data.status !== "running";
}

async function processJob(supabase: AdminClient, job: InFlightJob): Promise<JobResult> {
  try {
    if (!job.external_job_id) {
      // Nothing to check against AWS for a job with no recorded external id (a submission
      // that failed before MediaConvert returned one). Leave it — it still counts toward the
      // stuck signal if it's old enough.
      return { id: job.id, outcome: "stillRunning" };
    }

    let awsStatus: { status: string; errorMessage: string | null };
    try {
      awsStatus = await getJob(job.external_job_id);
    } catch (e) {
      // GetJob failed — an AWS/network hiccup, not evidence the transcode failed. Leave the
      // job for the next tick.
      console.error(`[transcode:poll] GetJob failed for ${job.id}: ${e instanceof Error ? e.message : e}`);
      return { id: job.id, outcome: "errored" };
    }

    const outcome = resolveJobOutcome(awsStatus.status);
    if (outcome === null) {
      return { id: job.id, outcome: "stillRunning" };
    }

    if (await alreadyTerminal(supabase, job.id)) {
      return { id: job.id, outcome: "alreadyResolved" };
    }

    if (outcome === "failed") {
      const reason = awsStatus.errorMessage ?? `MediaConvert reported ${awsStatus.status}`;
      const { error: rpcError } = await supabase.rpc("fail_transcode_job", { p_job_id: job.id, p_reason: reason });
      if (rpcError) {
        // The peek above just confirmed this row was active — a failure now, this close
        // behind that check, is a genuine anomaly (a very tight overlap with another run, or
        // a real bug), not the common race. Report it as such rather than guessing again.
        console.error(`[transcode:poll] fail_transcode_job error for ${job.id}: ${rpcError.message}`);
        return { id: job.id, outcome: "errored" };
      }
      return { id: job.id, outcome: "failed" };
    }

    // outcome === "complete". Verify the object actually exists — and actually has content —
    // before registering anything. A MediaConvert COMPLETE with nothing at the key, or a
    // 0-byte object, is not something a buyer page should ever be pointed at.
    let meta: { bytes: number; etag: string } | null;
    try {
      meta = await headObjectMeta(job.expected_output_key);
    } catch (e) {
      // A HeadObject failure that isn't a confirmed-absent NotFound (network, throttling,
      // permissions) is "we could not tell," not "the object is missing." Do not fail the job
      // on that basis — leave it for the next tick.
      console.error(`[transcode:poll] HeadObject failed for ${job.id}: ${e instanceof Error ? e.message : e}`);
      return { id: job.id, outcome: "errored" };
    }

    // Fix round 1, item 7: a 0-byte object is not a viewable screener. Treated identically to
    // a missing one — MediaConvert can report COMPLETE against a truncated or zero-length
    // write, and registering it would hand an external buyer a broken video, permanently
    // (register_transcode_output's row is never deleted, and a fresh proxy needs a whole new
    // job).
    if (!meta || meta.bytes === 0) {
      const reason = !meta
        ? "MediaConvert reported COMPLETE but the output object was not found in S3"
        : "MediaConvert reported COMPLETE but the output object is 0 bytes";
      const { error: rpcError } = await supabase.rpc("fail_transcode_job", { p_job_id: job.id, p_reason: reason });
      if (rpcError) {
        console.error(`[transcode:poll] fail_transcode_job error for ${job.id}: ${rpcError.message}`);
        return { id: job.id, outcome: "errored" };
      }
      return { id: job.id, outcome: "failed" };
    }

    // The key passed here is the JOB'S OWN recorded expected_output_key — never one derived or
    // taken from AWS/S3 — exactly as register_transcode_output's key-match check requires.
    const { error: registerError } = await supabase.rpc("register_transcode_output", {
      p_job_id: job.id,
      p_storage_key: job.expected_output_key,
      p_bytes: meta.bytes,
      p_content_hash: meta.etag,
    });
    if (registerError) {
      console.error(`[transcode:poll] register_transcode_output error for ${job.id}: ${registerError.message}`);
      return { id: job.id, outcome: "errored" };
    }
    return { id: job.id, outcome: "completed" };
  } catch (e) {
    // Belt-and-braces: one job's unexpected failure must never abort the rest of the poll.
    console.error(`[transcode:poll] unexpected error on job ${job.id}: ${e instanceof Error ? e.message : e}`);
    return { id: job.id, outcome: "errored" };
  }
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Bounded per @/lib/list-bounds — same pattern every other list read in this repo uses
  // since a092250. UNPAGINATED_MAX (500) is the house ceiling for a read that hasn't been
  // paginated yet; a backlog of 500+ in-flight jobs is itself the stuck-jobs signal below
  // firing loudly long before this bound would ever bite in practice.
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
    // A poll that silently only ever sees the first page of a growing backlog is the same
    // failure class as the truncation bug @/lib/list-bounds exists to catch.
    console.warn(
      `[transcode:poll] job selection truncated at ${UNPAGINATED_MAX} — the in-flight backlog is larger than one page`,
    );
  }

  let completed = 0;
  let failed = 0;
  let stillRunning = 0;
  // "errored" = we could not determine an outcome this tick (a MediaConvert/S3 call threw, or
  // an RPC itself errored for a reason other than the job already being resolved). These jobs
  // are left exactly as they were for the next tick — a transient AWS problem is not a failed
  // transcode, and must never be recorded as one.
  let errored = 0;
  // Jobs a concurrent overlapping run already resolved by the time this run reached them
  // (detected via alreadyTerminal's peek, not string-matching an RPC error — see above).
  let alreadyResolved = 0;
  // Fix round 1, item 6: jobs never even attempted this tick because the time budget ran out.
  // Distinct from stillRunning (which means we DID check AWS and it said non-terminal) —
  // these were never checked at all and will be the first thing the next tick looks at.
  let deferred = 0;

  // Tracks which of the selected jobs are still open (submitted/running) after this pass, for
  // the stuck-jobs count below. Starts as everything selected; anything this run resolves is
  // removed. Deferred jobs are never removed, which is correct — they are exactly as open as
  // they were before this tick started.
  const stillOpen = new Set(jobs.map((j) => j.id));

  const deadline = Date.now() + POLL_TIME_BUDGET_MS;
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    if (Date.now() > deadline) {
      deferred += jobs.length - i;
      console.warn(
        `[transcode:poll] time budget exceeded — deferring ${jobs.length - i} job(s) to the next tick`,
      );
      break;
    }

    const batch = jobs.slice(i, i + CONCURRENCY);
    // Each processJob call catches everything internally and never rejects, so Promise.all
    // here cannot short-circuit on one job's failure — every job in the batch is always
    // attempted regardless of how its neighbors resolve.
    const results = await Promise.all(batch.map((job) => processJob(supabase, job)));
    for (const result of results) {
      switch (result.outcome) {
        case "completed":
          completed++;
          stillOpen.delete(result.id);
          break;
        case "failed":
          failed++;
          stillOpen.delete(result.id);
          break;
        case "alreadyResolved":
          alreadyResolved++;
          stillOpen.delete(result.id);
          break;
        case "errored":
          errored++;
          break;
        case "stillRunning":
          stillRunning++;
          break;
      }
    }
  }

  const stuckCutoff = Date.now() - STUCK_THRESHOLD_MS;
  const stuck = jobs.filter(
    (j) => stillOpen.has(j.id) && new Date(j.created_at).getTime() < stuckCutoff,
  ).length;
  if (stuck > 0) {
    console.warn(`[transcode:stuck] ${stuck} job(s) older than 60m still in flight`);
  }

  // Fix round 1, item 5: the one thing Vercel itself surfaces (an invocation's HTTP status)
  // must not stay green through a total AWS outage. A non-empty run where every single job
  // came back "errored" — not merely stillRunning, not a mix — means every AWS/S3 call this
  // tick failed to produce an answer at all, which is worth a loud signal on its own.
  const allErrored = jobs.length > 0 && errored === jobs.length;

  return NextResponse.json(
    { checked: jobs.length, completed, failed, stillRunning, errored, alreadyResolved, deferred, truncated, stuck },
    { status: allErrored ? 503 : 200 },
  );
}
