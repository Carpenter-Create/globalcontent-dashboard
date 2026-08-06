import "server-only";

// Memoises signed URLs across requests on a warm function instance.
//
// WHY. Signing a CloudFront URL is an RSA operation — real CPU, not a lookup. Production
// profiling measured artwork signing at 35–43ms per /titles render for a handful of
// titles, and it scales linearly: 100 titles is 100 signatures on every render, of every
// page, for every user.
//
// It was unavoidable while every render produced a different URL. Now that artwork
// expiries are quantised to a window (lib/signing-window), the signature for a given key
// is IDENTICAL for the whole window — so recomputing it is pure waste.
//
// Keyed by storage key + the window boundary, so it self-invalidates: when the window
// rolls over the key changes and the old entry is never read again. No TTL logic, no
// staleness risk — a cached URL is byte-identical to what signing would produce.
//
// Bounded, because a serverless instance is long-lived under Fluid Compute and an
// unbounded map on a large catalog is a slow memory leak. Simple generational eviction
// rather than an LRU: on overflow, drop everything. Worst case is one window of
// re-signing, which is exactly the behaviour we had before.

const MAX_ENTRIES = 2000;
const cache = new Map<string, string>();

export function cachedSignedUrl(
  storageKey: string,
  windowBoundary: number,
  sign: () => string,
): string {
  const k = `${windowBoundary}:${storageKey}`;
  const hit = cache.get(k);
  if (hit !== undefined) return hit;

  const url = sign();
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(k, url);
  return url;
}

/** Test seam. */
export function _resetSignedUrlCache() {
  cache.clear();
}

/** Test seam. */
export function _signedUrlCacheSize() {
  return cache.size;
}
