import "server-only";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  RestoreObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { stableSigningDate } from "@/lib/signing-window";

// Server-only S3 client. Credentials come from AWS_ACCESS_KEY_ID /
// AWS_SECRET_ACCESS_KEY / AWS_REGION in the environment (never NEXT_PUBLIC).
const region = process.env.AWS_REGION!;
export const S3_BUCKET = process.env.S3_BUCKET!;
const s3 = new S3Client({ region });

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
