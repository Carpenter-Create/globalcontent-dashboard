import "server-only";
import { MediaConvertClient, CreateJobCommand, type JobSettings } from "@aws-sdk/client-mediaconvert";

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
const mediaconvert = new MediaConvertClient({
  region,
  endpoint: process.env.MEDIACONVERT_ENDPOINT,
});

// Deliberately thin: all encoding and output-key logic lives in mediaconvert-settings.ts
// (pure, unit-tested, no AWS import). This function's only job is to call AWS with what
// that module derived.
export async function submitProxyJob(input: {
  masterKey: string;
}): Promise<{ externalJobId: string; expectedKey: string }> {
  const { expectedKey } = proxyOutputKey(input.masterKey);
  const settings = buildProxyJobSettings({ masterKey: input.masterKey, bucket: S3_BUCKET });

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
  return { externalJobId: out.Job.Id, expectedKey };
}
