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

// A transcode already takes minutes; every real transcode this pipeline will ever run
// finishes in well under an hour. 60 minutes is comfortably longer than that plus several
// missed 5-minute ticks, so a job still open past it is a genuine signal something stalled
// (a paused scheduler, an AWS-side problem, a bug here) rather than normal latency.
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
  // Jobs a concurrent overlapping run already resolved by the time this run reached them.
  // register_transcode_output is idempotent on job id (Task 2's row lock + status check) —
  // this route does not need its own lock, only to recognise that outcome as a no-op rather
  // than a failure.
  let alreadyResolved = 0;

  // Tracks which of the selected jobs are still open (submitted/running) after this pass, for
  // the stuck-jobs count below. Starts as everything selected; anything this run resolves is
  // removed.
  const stillOpen = new Set(jobs.map((j) => j.id));

  for (const job of jobs) {
    try {
      if (!job.external_job_id) {
        // Nothing to check against AWS for a job with no recorded external id (a submission
        // that failed before MediaConvert returned one). Leave it — it still counts toward
        // the stuck signal below if it's old enough.
        stillRunning++;
        continue;
      }

      let awsStatus: { status: string; errorMessage: string | null };
      try {
        awsStatus = await getJob(job.external_job_id);
      } catch (e) {
        // GetJob failed — an AWS/network hiccup, not evidence the transcode failed. Leave the
        // job for the next tick.
        console.error(`[transcode:poll] GetJob failed for ${job.id}: ${e instanceof Error ? e.message : e}`);
        errored++;
        continue;
      }

      const outcome = resolveJobOutcome(awsStatus.status);

      if (outcome === null) {
        stillRunning++;
        continue;
      }

      if (outcome === "failed") {
        const reason = awsStatus.errorMessage ?? `MediaConvert reported ${awsStatus.status}`;
        const { error: rpcError } = await supabase.rpc("fail_transcode_job", {
          p_job_id: job.id,
          p_reason: reason,
        });
        if (rpcError) {
          if (/already complete/i.test(rpcError.message)) {
            // A concurrent run already registered this job as complete before this run's own
            // (stale) ERROR/CANCELED read reached the RPC. That is a race outcome, not a
            // failure of this poll — log it as a no-op.
            console.warn(`[transcode:poll] job ${job.id} already complete (concurrent run) — no-op`);
            alreadyResolved++;
            stillOpen.delete(job.id);
            continue;
          }
          console.error(`[transcode:poll] fail_transcode_job error for ${job.id}: ${rpcError.message}`);
          errored++;
          continue;
        }
        failed++;
        stillOpen.delete(job.id);
        continue;
      }

      // outcome === "complete". Verify the object actually exists before registering
      // anything — a MediaConvert COMPLETE with nothing at the key is not something a buyer
      // page should ever be pointed at.
      let meta: { bytes: number; etag: string } | null;
      try {
        meta = await headObjectMeta(job.expected_output_key);
      } catch (e) {
        // A HeadObject failure that isn't "confirmed absent" (network, throttling,
        // permissions) is "we could not tell," not "the object is missing." Do not fail the
        // job on that basis — leave it for the next tick.
        console.error(`[transcode:poll] HeadObject failed for ${job.id}: ${e instanceof Error ? e.message : e}`);
        errored++;
        continue;
      }

      if (!meta) {
        const { error: rpcError } = await supabase.rpc("fail_transcode_job", {
          p_job_id: job.id,
          p_reason: "MediaConvert reported COMPLETE but the output object was not found in S3",
        });
        if (rpcError) {
          console.error(`[transcode:poll] fail_transcode_job error for ${job.id}: ${rpcError.message}`);
          errored++;
          continue;
        }
        failed++;
        stillOpen.delete(job.id);
        continue;
      }

      // The key passed here is the JOB'S OWN recorded expected_output_key — never one derived
      // or taken from AWS/S3 — exactly as register_transcode_output's key-match check
      // requires.
      const { error: registerError } = await supabase.rpc("register_transcode_output", {
        p_job_id: job.id,
        p_storage_key: job.expected_output_key,
        p_bytes: meta.bytes,
        p_content_hash: meta.etag,
      });
      if (registerError) {
        console.error(`[transcode:poll] register_transcode_output error for ${job.id}: ${registerError.message}`);
        errored++;
        continue;
      }
      completed++;
      stillOpen.delete(job.id);
    } catch (e) {
      // Belt-and-braces: one job's unexpected failure must never abort the rest of the poll.
      console.error(`[transcode:poll] unexpected error on job ${job.id}: ${e instanceof Error ? e.message : e}`);
      errored++;
    }
  }

  const stuckCutoff = Date.now() - STUCK_THRESHOLD_MS;
  const stuck = jobs.filter(
    (j) => stillOpen.has(j.id) && new Date(j.created_at).getTime() < stuckCutoff,
  ).length;
  if (stuck > 0) {
    console.warn(`[transcode:stuck] ${stuck} job(s) older than 60m still in flight`);
  }

  return NextResponse.json({
    checked: jobs.length,
    completed,
    failed,
    stillRunning,
    errored,
    alreadyResolved,
    truncated,
    stuck,
  });
}
