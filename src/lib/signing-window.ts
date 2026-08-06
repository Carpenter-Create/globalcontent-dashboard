// Stable expiry windows for signed URLs.
//
// THE BUG THIS FIXES. Signed URLs were minted with `dateLessThan: now + ttl`, so every
// render produced a different expiry, therefore a different signature, therefore a
// DIFFERENT URL for the same image. The browser had never seen that URL, so it
// re-downloaded the asset — on every navigation. With 2.5–3.2 MB posters that is
// megabytes of JPEG per click, which measured as ~1.1s of the ~1.5s navigation lag while
// the server render itself was only ~180ms.
//
// Quantising the expiry to a fixed window makes every render inside that window produce
// the IDENTICAL url, so browser cache, CDN cache and the Next image optimiser all start
// working. This is the difference between "re-download 3 MB" and "304 Not Modified".
//
// TRADE-OFF, stated plainly: a quantised URL stays valid for between 1x and 2x the window
// rather than exactly ttl, so the worst-case life of a leaked URL doubles. That is a fair
// trade for artwork — promotional material that becomes public on distribution — and it is
// why this is opt-in per call site rather than the default. Master downloads and screener
// streams keep exact, non-quantised expiries.

/**
 * Expiry (epoch seconds) quantised to `windowSeconds`, always at least one full window in
 * the future. Every call inside the same window returns the same value.
 */
export function stableExpiryEpoch(windowSeconds: number, now: number = Date.now()): number {
  if (windowSeconds <= 0) throw new Error("windowSeconds must be positive");
  const nowSec = Math.floor(now / 1000);
  return (Math.floor(nowSec / windowSeconds) + 2) * windowSeconds;
}

/** The same boundary as a Date, for signers that want an absolute instant. */
export function stableExpiryDate(windowSeconds: number, now: number = Date.now()): Date {
  return new Date(stableExpiryEpoch(windowSeconds, now) * 1000);
}

/**
 * Start of the current window, as a Date. The S3 presigner takes `expiresIn` (relative)
 * rather than an absolute expiry, so pinning its `signingDate` to the window start is what
 * makes ITS output stable.
 */
export function stableSigningDate(windowSeconds: number, now: number = Date.now()): Date {
  if (windowSeconds <= 0) throw new Error("windowSeconds must be positive");
  const nowSec = Math.floor(now / 1000);
  return new Date(Math.floor(nowSec / windowSeconds) * windowSeconds * 1000);
}
