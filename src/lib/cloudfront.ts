import "server-only";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { PORTAL } from "@/lib/portal";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/** Mint a short-lived CloudFront signed URL for a private S3-backed object key. */
export function signAssetUrl(storageKey: string, ttlSeconds: number = PORTAL.signedUrlTtlSeconds): string {
  const domain = requireEnv("CLOUDFRONT_DOMAIN").replace(/\/+$/, "");
  const keyPairId = requireEnv("CLOUDFRONT_KEY_PAIR_ID");
  const privateKey = requireEnv("CLOUDFRONT_PRIVATE_KEY");
  const key = storageKey.replace(/^\/+/, "");
  return getSignedUrl({
    url: `${domain}/${key}`,
    keyPairId,
    privateKey,
    dateLessThan: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
}
