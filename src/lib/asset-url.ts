import "server-only";

import { signAssetUrl } from "@/lib/cloudfront";
import { presignGetObject } from "@/lib/s3";
import { PORTAL } from "@/lib/portal";

// The ONE way to turn a stored S3 key into a URL a browser may fetch.
//
// PRODUCTION: always CloudFront + a signed URL. The bucket is private (OAC only), the
// distribution enforces TrustedKeyGroups, and no S3 URL is ever handed to a client.
//
// LOCAL / PREVIEW: the CloudFront distribution origins from the PROD bucket only, so a key
// uploaded locally into gc-content-assets-dev can never be served through it — you get a
// 403 or, if the CloudFront env is absent, an exception. Previously artwork.ts swallowed
// that and rendered the monogram placeholder, which is why locally-uploaded artwork never
// appeared. Outside production we presign directly from S3 instead, so artwork renders,
// downloads work and the screener actually plays against the dev bucket.
//
// WHY A GATE AT ALL and not merely "CloudFront env is missing": an S3 presign would still
// SUCCEED in production — the app's IAM policy grants s3:GetObject on both buckets — and
// would silently bypass CloudFront, OAC and the signed-URL key group. A missing env var in
// production must fail loudly, not degrade into a private-bucket bypass.
//
// WHY VERCEL_ENV AND NOT NODE_ENV: `next start` sets NODE_ENV=production, so a production
// build run on a laptop — which is how we measure real timings — looked identical to the
// deployed site and tripped this guard, leaving artwork on the monogram placeholder.
// VERCEL_ENV is 'production' ONLY on a production deployment: undefined locally, 'preview'
// on preview builds. That is the distinction actually meant here.
export async function assetViewUrl(
  storageKey: string,
  ttlSeconds: number = PORTAL.signedUrlTtlSeconds,
): Promise<string> {
  if (process.env.CLOUDFRONT_DOMAIN) return signAssetUrl(storageKey, ttlSeconds);

  if (process.env.VERCEL_ENV === "production") {
    throw new Error(
      "CLOUDFRONT_DOMAIN is not set on a production deployment. Refusing to presign S3 " +
        "directly — that would bypass CloudFront, OAC and the signed-URL key group.",
    );
  }

  // Loud on purpose: serving assets straight from S3 is a local-only affordance, and a
  // silent fallback is exactly how it would end up somewhere it should not be.
  console.warn(
    `[asset-url] CLOUDFRONT_DOMAIN unset — presigning S3 directly (local/preview only): ${storageKey}`,
  );
  return presignGetObject(storageKey, ttlSeconds);
}
