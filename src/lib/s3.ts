import "server-only";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  RestoreObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { stableSigningDate } from "@/lib/signing-window";

// Server-only S3 client. Credentials come from AWS_ACCESS_KEY_ID /
// AWS_SECRET_ACCESS_KEY / AWS_REGION in the environment (never NEXT_PUBLIC).
//
// Fix round 1 (screener-proxy poll review), item 2: `process.env.X!` is a TypeScript-only
// cast — at runtime an unset var is simply `undefined`, and nothing here used to notice.
// headObjectMeta() below treats a confirmed-absent object as "the transcode failed" and
// permanently fails the job (an irreversible, no-delete row). An unset S3_BUCKET would have
// sent `Bucket: undefined` into every HeadObject call, which S3 answers with the same 404 a
// genuinely missing key gets — so a bad deploy (env var never set, or a typo'd project
// linking) would have looked identical to "every transcode failed," permanently, for every
// job. Failing loudly at import time — before any request is ever served — turns that into an
// immediate, obvious deploy failure instead of a slow-burning data-integrity incident.
const rawRegion = process.env.AWS_REGION;
const rawBucket = process.env.S3_BUCKET;
if (!rawRegion) throw new Error("AWS_REGION environment variable is not set");
if (!rawBucket) throw new Error("S3_BUCKET environment variable is not set");
// Narrowed to `string` (not `string | undefined`) by the checks above, so every call site
// below keeps exactly the type contract the old non-null assertion claimed but never verified.
const region: string = rawRegion;
export const S3_BUCKET: string = rawBucket;
const s3 = new S3Client({ region });

// Fix round 2, item 3 — a SEPARATE client, deliberately, not a config change to `s3` above.
// The SDK default is NO request timeout and 3 retry attempts with backoff: a single hanging
// call had no ceiling at all, which meant the scheduled poll's between-batch time budget
// (route.ts) could never actually bind — one stuck GetJob/HeadObject could carry an
// invocation past `maxDuration`, at which point the platform kills it and the summary, the
// stuck-jobs warning, and the deferred count are all lost, exactly what the budget exists to
// prevent. A tight timeout is right for the poll's own calls but WRONG for `s3` above:
// `completeMultipart` assembles a large multipart master upload server-side, which AWS
// documents as potentially taking longer than a few seconds for very large objects with many
// parts — a shared low `requestTimeout` would turn a slow-but-healthy large-file completion
// into a spurious failure, a regression far worse than anything this fix round is trying to
// close. So only the poll's own client gets the tight ceiling.
//
// `requestHandler` accepts a plain options object here (no need to construct a
// NodeHttpHandler instance, and no new dependency: @smithy/node-http-handler is only a
// TRANSITIVE dependency of @aws-sdk/client-s3 under pnpm's strict linking, not resolvable from
// application code without adding it directly). `throwOnRequestTimeout: true` is required —
// this behavior IS documented, just easy to miss: @smithy/types' NodeHttpHandlerOptions says
// `requestTimeout` alone only logs a warning on breach and needs this flag to actually throw.
// `maxAttempts: 2` bounds the SDK's own retry loop so a single logical call can't silently
// re-stack its timeout budget.
//
// NOT strictly "the first line of defense" in every case (corrected fix round 3, item 4): a
// SINGLE attempt's requestTimeout (6s) is tighter than route.ts's withTimeout race (10s) and
// does fire first for a single hang. But maxAttempts: 2 means a call that keeps timing out is
// retried internally before the SDK rejects to the caller at all — two attempts at ~6s plus
// backoff (~12s+) is LOOSER than route.ts's flat 10s ceiling. So for a call that keeps failing
// and retrying, route.ts's race is what actually determines when the caller sees a rejection,
// not this config. This config's real value is bounding each individual attempt quickly; the
// route's race is the outer ceiling regardless of how the SDK retries underneath it.
const POLL_REQUEST_TIMEOUT_MS = 6_000;
const POLL_CONNECTION_TIMEOUT_MS = 3_000;
const pollS3 = new S3Client({
  region,
  requestHandler: {
    connectionTimeout: POLL_CONNECTION_TIMEOUT_MS,
    requestTimeout: POLL_REQUEST_TIMEOUT_MS,
    throwOnRequestTimeout: true,
  },
  maxAttempts: 2,
});

const PRESIGN_TTL = 900; // 15 minutes

// Objects are tagged at creation so the archival rule can select them.
//
// WHY A TAG AND NOT A PREFIX: assetKey() builds
//   orgs/<org>/titles/<title>/<kind>/<uuid>/<file>
// so "master" sits MID-KEY, and S3 lifecycle/tiering filters match on prefix only. The
// runbook's "scope the rule to master/" instruction would match ZERO objects and archive
// nothing, while showing a green enabled rule in the console. Tagging is the only way to
// select by kind.
//
// Only masters are archived. Artwork stays instant — it is 2–3 MB, it is on every catalog
// page, and a poster behind a 12-hour restore is a broken image for a trivial saving.
export const ARCHIVE_TAG_KEY = "gc-archive";
export const ARCHIVE_TAG_VALUE = "master";

export async function createMultipart(
  key: string,
  contentType?: string,
  opts: { archivable?: boolean } = {},
): Promise<string> {
  const out = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType,
      // Set at creation rather than via a follow-up PutObjectTagging: one call, and no
      // window where a master exists untagged and is therefore invisible to the rule.
      ...(opts.archivable ? { Tagging: `${ARCHIVE_TAG_KEY}=${ARCHIVE_TAG_VALUE}` } : {}),
    }),
  );
  if (!out.UploadId) throw new Error("S3 did not return an UploadId");
  return out.UploadId;
}

// Presign a plain UploadPart (SignedHeaders=host). The browser PUTs the raw part
// bytes to this URL; S3 returns the part ETag. (Per-part SHA-256 checksums are a
// noted follow-up — the presigned-checksum flow is unreliable from the browser.)
export async function signUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
): Promise<string> {
  return getSignedUrl(
    s3,
    new UploadPartCommand({ Bucket: S3_BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }),
    { expiresIn: PRESIGN_TTL },
  );
}

// Assemble the parts and return the object ETag (S3-verified) for content_hash.
export async function completeMultipart(
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string }[],
): Promise<string> {
  const out = await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
          .slice()
          .sort((a, b) => a.PartNumber - b.PartNumber)
          .map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
      },
    }),
  );
  if (!out.ETag) throw new Error("S3 did not return an ETag");
  return out.ETag.replace(/"/g, ""); // strip the quotes S3 wraps ETags in
}

// Presigned GET straight from S3. LOCAL/PREVIEW ONLY — see lib/asset-url.
// Production serves every asset through CloudFront + OAC so the bucket stays private;
// this exists because the CloudFront distribution origins from the PROD bucket only, so a
// dev-bucket key can never be served through it. Supports range requests, so video
// scrubbing works. The caller decides when this is permissible, not this function.
export async function presignGetObject(
  key: string,
  ttlSeconds: number,
  opts: { stableWindow?: boolean } = {},
): Promise<string> {
  // The S3 presigner takes a RELATIVE expiresIn, so pinning signingDate to the window
  // start is what makes its output identical across the window — the same caching win as
  // the CloudFront path.
  if (!opts.stableWindow) {
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }
  // Pinning signingDate to the window START makes the URL identical across the window,
  // but expiresIn is measured FROM that pinned date — so a plain ttl would have the URL
  // die exactly at the boundary, meaning a page loaded late in the window gets a URL good
  // for seconds. Double it so validity is always at least one full window ahead, matching
  // what stableExpiryDate gives the CloudFront path. (Caught in review on PR #78.)
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), {
    expiresIn: ttlSeconds * 2,
    signingDate: stableSigningDate(ttlSeconds),
  });
}

// ---- Glacier restore (Portal-3) --------------------------------------------
// Masters transition to Glacier Flexible at 90 days (S3 lifecycle policy, not code).
// A portal access to an archived master must detect it, kick off a Standard restore,
// and serve only once the temp copy is available. S3 HEAD is the source of truth.

export type RestoreState = "none" | "restoring" | "available";

// Pure: map S3's StorageClass + x-amz-restore header to a servable state. STANDARD (S3
// omits StorageClass for it) → available. GLACIER/DEEP_ARCHIVE → none until a restore is
// requested; ongoing-request="true" → restoring; ="false" (with expiry-date) → available.
export function parseRestore(
  restoreHeader: string | undefined,
  storageClass: string | undefined,
  archiveStatus?: string,
): RestoreState {
  // INTELLIGENT_TIERING reports its class as INTELLIGENT_TIERING whatever tier the object
  // is actually in; the tier lives in a SEPARATE x-amz-archive-status header. Testing
  // storageClass alone would call an archived object "available", hand out a signed URL,
  // and 403 the download. The two archive statuses are ARCHIVE_ACCESS and
  // DEEP_ARCHIVE_ACCESS — the automatic Frequent/Infrequent/Archive-Instant tiers set no
  // status at all and are genuinely instant.
  const intelligentlyArchived =
    storageClass === "INTELLIGENT_TIERING" &&
    (archiveStatus === "ARCHIVE_ACCESS" || archiveStatus === "DEEP_ARCHIVE_ACCESS");
  const archived =
    storageClass === "GLACIER" || storageClass === "DEEP_ARCHIVE" || intelligentlyArchived;

  if (!archived) return "available";
  if (!restoreHeader) return "none";
  if (/ongoing-request="true"/.test(restoreHeader)) return "restoring";
  if (/ongoing-request="false"/.test(restoreHeader)) return "available";
  return "none";
}

export async function headObjectRestore(key: string): Promise<RestoreState> {
  const out = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  return parseRestore(out.Restore, out.StorageClass, out.ArchiveStatus);
}

// Used by the scheduled transcode poll to verify a MediaConvert-reported COMPLETE actually
// produced an object before registering it as an asset.
//
// Returns null ONLY for a CONFIRMED-absent object, never for any other failure. That
// distinction matters: a transient network blip, a throttle, or a permissions problem must
// not be read as "the object doesn't exist," or the poll would fail a job that may in fact be
// fine, on a truth it never actually established.
//
// Fix round 1, item 2 — narrowed from `name === "NotFound" || statusCode === 404` to
// `name === "NotFound"` alone: a bare status-code check also matches any OTHER 404 the SDK
// did not itself recognise as a modeled NotFound, which is exactly the failure-toward-"absent"
// direction this function must not take.
//
// Fix round 2, item 2 — CLOSES what fix round 1 documented as an honest, unresolved limit.
// AWS's HeadObject returns an identical, bodyless 404 whether the KEY is missing or the
// BUCKET itself is missing — there is no response body on a HEAD request for the SDK to read
// a distinguishing code from, and no exception-shape check on HeadObject's own error can tell
// these apart (verified against this SDK's waitUntilObjectExists/waitUntilBucketExists
// helpers, which both key off nothing but `exception.name === "NotFound"`). But `HeadBucket`,
// run against the BUCKET ALONE, distinguishes them definitively — and it needs exactly the
// `s3:ListBucket` permission fix round 1 already added for this same function. So: on a
// HeadObject NotFound ONLY (the rare path — most calls succeed), issue one extra HeadBucket
// call. Bucket reachable → the KEY genuinely doesn't exist → confirmed absent, return null.
// Bucket unreachable (missing, renamed, wrong account, access revoked) → this was never a
// confirmed-absent KEY, it's a broken pointer — throw, so the caller treats it as "could not
// tell" (errored, retried next tick) rather than permanently failing a job over a
// configuration fault. This is why fix round 1's item 1 (the s3:ListBucket grant) MUST NOT
// reach production before this function does: granting ListBucket without this check is what
// turns a 403-forever-retry (wasteful, harmless) into a 404-fail-on-first-observation
// (irreversible) — see route.ts's fleet-wide corroboration gate for the other half of that
// fix.
export async function headObjectMeta(key: string): Promise<{ bytes: number; etag: string } | null> {
  try {
    const out = await pollS3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return { bytes: out.ContentLength ?? 0, etag: (out.ETag ?? "").replace(/"/g, "") };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name !== "NotFound") throw e;

    try {
      await pollS3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    } catch (bucketError) {
      throw new Error(
        `S3 bucket "${S3_BUCKET}" is not accessible (cannot confirm object absence for ${key}): ` +
          (bucketError instanceof Error ? bucketError.message : String(bucketError)),
      );
    }
    return null; // Bucket confirmed reachable — the 404 was genuinely about the key.
  }
}

// Standard-tier restore, temp copy kept for `days`. Idempotent: a restore already in
// progress (or complete) is not an error for our purposes.
export async function initiateRestore(key: string, days = 7): Promise<void> {
  try {
    await s3.send(
      new RestoreObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        RestoreRequest: { Days: days, GlacierJobParameters: { Tier: "Standard" } },
      }),
    );
  } catch (e) {
    const name = (e as { name?: string; Code?: string })?.name ?? (e as { Code?: string })?.Code;
    if (name === "RestoreAlreadyInProgress") return;
    throw e;
  }
}

// The gate both portal routes call before signing: available → sign & serve; archived →
// (initiate if needed and) report restoring so the route returns "preparing".
export async function resolveOrRestore(
  key: string,
): Promise<{ status: "available" } | { status: "restoring"; justInitiated: boolean }> {
  const state = await headObjectRestore(key);
  if (state === "available") return { status: "available" };
  if (state === "restoring") return { status: "restoring", justInitiated: false };
  await initiateRestore(key);
  return { status: "restoring", justInitiated: true };
}
