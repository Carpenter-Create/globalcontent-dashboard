import "server-only";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { PORTAL } from "@/lib/portal";
import { stableExpiryDate, stableExpiryEpoch } from "@/lib/signing-window";
import { cachedSignedUrl } from "@/lib/signed-url-cache";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/**
 * Mint a short-lived CloudFront signed URL for a private S3-backed object key.
 *
 * `stableWindow` quantises the expiry so every call inside the window returns the
 * IDENTICAL url — which is what allows the browser and CDN to cache it. Without it, a
 * fresh expiry per render means a fresh signature, a fresh URL, and a full re-download
 * of the asset on every navigation. Opt-in, because it doubles the worst-case life of a
 * leaked URL; see lib/signing-window.
 */
export function signAssetUrl(
  storageKey: string,
  ttlSeconds: number = PORTAL.signedUrlTtlSeconds,
  opts: { stableWindow?: boolean } = {},
): string {
  const domain = requireEnv("CLOUDFRONT_DOMAIN").replace(/\/+$/, "");
  const keyPairId = requireEnv("CLOUDFRONT_KEY_PAIR_ID");
  const privateKey = requireEnv("CLOUDFRONT_PRIVATE_KEY");
  const key = storageKey.replace(/^\/+/, "");
  const url = `${domain}/${key}`;

  if (!opts.stableWindow) {
    const dateLessThan = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    return getSignedUrl({ url, keyPairId, privateKey, dateLessThan });
  }

  // Stable window => the signature is identical for the whole window, so signing it more
  // than once is wasted RSA. Cached across requests on a warm instance.
  const boundary = stableExpiryEpoch(ttlSeconds);
  return cachedSignedUrl(storageKey, boundary, () =>
    getSignedUrl({
      url,
      keyPairId,
      privateKey,
      dateLessThan: stableExpiryDate(ttlSeconds).toISOString(),
    }),
  );
}
