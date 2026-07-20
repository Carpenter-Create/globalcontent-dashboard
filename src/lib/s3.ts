import "server-only";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  HeadObjectCommand,
  RestoreObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Server-only S3 client. Credentials come from AWS_ACCESS_KEY_ID /
// AWS_SECRET_ACCESS_KEY / AWS_REGION in the environment (never NEXT_PUBLIC).
const region = process.env.AWS_REGION!;
export const S3_BUCKET = process.env.S3_BUCKET!;
const s3 = new S3Client({ region });

const PRESIGN_TTL = 900; // 15 minutes

export async function createMultipart(key: string, contentType?: string): Promise<string> {
  const out = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: S3_BUCKET, Key: key, ContentType: contentType }),
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
): RestoreState {
  const archived = storageClass === "GLACIER" || storageClass === "DEEP_ARCHIVE";
  if (!archived) return "available";
  if (!restoreHeader) return "none";
  if (/ongoing-request="true"/.test(restoreHeader)) return "restoring";
  if (/ongoing-request="false"/.test(restoreHeader)) return "available";
  return "none";
}

export async function headObjectRestore(key: string): Promise<RestoreState> {
  const out = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  return parseRestore(out.Restore, out.StorageClass);
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
