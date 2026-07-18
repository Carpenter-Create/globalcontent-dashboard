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
    new CreateMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ChecksumAlgorithm: "SHA256",
    }),
  );
  if (!out.UploadId) throw new Error("S3 did not return an UploadId");
  return out.UploadId;
}

// Presign one UploadPart with its SHA-256 (base64) so S3 verifies integrity and
// the client sends the matching x-amz-checksum-sha256 header.
export async function signUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  checksumSHA256: string,
): Promise<string> {
  return getSignedUrl(
    s3,
    new UploadPartCommand({
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      ChecksumSHA256: checksumSHA256,
    }),
    { expiresIn: PRESIGN_TTL },
  );
}

export async function completeMultipart(
  key: string,
  uploadId: string,
  parts: { PartNumber: number; ETag: string; ChecksumSHA256: string }[],
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
          .map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag, ChecksumSHA256: p.ChecksumSHA256 })),
      },
    }),
  );
  if (!out.ChecksumSHA256) throw new Error("S3 did not return an object checksum");
  return out.ChecksumSHA256; // composite, e.g. "base64hash-<partCount>"
}
