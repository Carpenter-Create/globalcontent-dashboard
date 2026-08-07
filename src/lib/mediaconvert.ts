import "server-only";
import { MediaConvertClient, CreateJobCommand, GetJobCommand, type JobSettings } from "@aws-sdk/client-mediaconvert";

import { S3_BUCKET } from "@/lib/s3";
import { proxyOutputKey, buildProxyJobSettings } from "@/lib/mediaconvert-settings";

// Server-only MediaConvert client. Credentials come from AWS_ACCESS_KEY_ID /
// AWS_SECRET_ACCESS_KEY / AWS_REGION in the environment (never NEXT_PUBLIC) — same
// convention as lib/s3.ts.
//
// MEDIACONVERT_ENDPOINT is required and per-account/per-region (there is no shared
// default endpoint the way there is for S3): `aws mediaconvert describe-endpoints`,
// documented in docs/infra/screener-proxy-setup.md. Without it the SDK would hit the
// generic regional endpoint and every call would fail.
const region = process.env.AWS_REGION!;

// Fix round 2, item 3 (screener-proxy poll review): the SDK default is no request timeout and
// 3 retry attempts — a hanging `GetJob` had no ceiling, which meant the scheduled poll's
// between-batch time budget (route.ts) could never actually bind: one stuck call could carry
// the invocation past `maxDuration`, losing the summary/stuck-warning/deferred-count the
// budget exists to preserve. Safe to apply to BOTH calls this client makes — unlike
// `completeMultipart` in `s3.ts` (which genuinely can take longer for a very large multipart
// assembly, so it deliberately keeps an untimed client), `CreateJob` (submit) and `GetJob`
// (poll) are both small, fast metadata calls with no legitimate reason to run long.
// `throwOnRequestTimeout: true` is required alongside `requestTimeout` — this IS documented
// (@smithy/types' NodeHttpHandlerOptions), just easy to miss: without it, a breach only logs a
// warning and never throws.
//
// NOT strictly "the first line of defense" in every case (corrected fix round 3, item 4): this
// config's 6s per-attempt timeout is tighter than route.ts's 10s withTimeout race for a SINGLE
// hang, but `maxAttempts: 2` retries internally before the SDK ever rejects to the caller — two
// attempts at ~6s plus backoff (~12s+) is looser than route.ts's flat 10s. So for a call that
// keeps timing out and retrying, route.ts's race is what actually determines when the caller
// sees a rejection, not this config — this config's value is bounding each attempt quickly;
// route.ts's race is the outer ceiling regardless of how the SDK retries underneath it.
const mediaconvert = new MediaConvertClient({
  region,
  endpoint: process.env.MEDIACONVERT_ENDPOINT,
  requestHandler: {
    connectionTimeout: 3_000,
    requestTimeout: 6_000,
    throwOnRequestTimeout: true,
  },
  maxAttempts: 2,
});

// Deliberately thin: all encoding and output-key logic lives in mediaconvert-settings.ts
// (pure, unit-tested, no AWS import). This function's only job is to call AWS with what
// that module derived.
export async function submitProxyJob(input: {
  masterKey: string;
}): Promise<{ externalJobId: string; expectedKey: string }> {
  // Derived exactly once: buildProxyJobSettings takes the result rather than re-deriving it
  // from masterKey itself, so proxyOutputKey's parse/validation of masterKey runs a single
  // time per job, not twice.
  const output = proxyOutputKey(input.masterKey);
  const settings = buildProxyJobSettings({ masterKey: input.masterKey, bucket: S3_BUCKET, output });

  const out = await mediaconvert.send(
    new CreateJobCommand({
      Role: process.env.MEDIACONVERT_ROLE_ARN,
      Queue: process.env.MEDIACONVERT_QUEUE_ARN,
      // buildProxyJobSettings deliberately returns plain data (Record<string, unknown>) so
      // mediaconvert-settings.ts stays free of the AWS SDK and unit-testable without
      // credentials. This cast is the one place that data crosses into the SDK's shape.
      Settings: settings as unknown as JobSettings,
    }),
  );
  if (!out.Job?.Id) throw new Error("MediaConvert did not return a job id");
  return { externalJobId: out.Job.Id, expectedKey: output.expectedKey };
}

// Used by the scheduled poll (src/app/api/cron/transcode-poll) to check on a submitted job.
// Deliberately thin, same as submitProxyJob: this is the only place that touches the SDK for
// a status check, so it stays untested-by-necessity while transcode-poll.ts's decision logic
// (what a given status MEANS) stays pure and fully unit-tested.
//
// Throws on a genuine AWS/network failure — the caller (the route) must not mistake "we
// could not reach MediaConvert" for "the transcode failed"; those are different outcomes
// and only the route decides what to do with each.
export async function getJob(externalJobId: string): Promise<{ status: string; errorMessage: string | null }> {
  const out = await mediaconvert.send(new GetJobCommand({ Id: externalJobId }));
  if (!out.Job?.Status) throw new Error("MediaConvert did not return a job status");
  return { status: out.Job.Status, errorMessage: out.Job.ErrorMessage ?? null };
}
