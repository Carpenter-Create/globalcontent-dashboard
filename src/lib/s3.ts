import "server-only";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
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
