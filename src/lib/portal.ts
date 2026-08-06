import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const PORTAL = {
  linkTtlDays: 14,
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
  sessionTtlHours: 24,
  signedUrlTtlSeconds: 300, // master DOWNLOAD: a single GET only needs to start within the TTL
  // Artwork (poster/banner) embedded as <img> on a page that may stay open for hours. The
  // download TTL above is wrong here for the reason stated above it — an <img> is not "a
  // single GET that starts immediately". If the browser evicts the image and re-requests it,
  // an expired URL renders as a broken image on a page the user never navigated away from.
  // 1h is comfortably longer than any render needs while staying leak-hygienic, and artwork
  // is the least sensitive asset class: it is promotional material that becomes public the
  // moment a title is distributed.
  artworkTtlSeconds: 3600,
  // Screener STREAM: a <video> issues byte-range GETs across the whole runtime and CloudFront
  // re-validates the signed URL on every request, so this must cover a full film + pauses,
  // not just playback start. Kept well under the 24h session for leak hygiene (view-only, no DRM).
  screenerStreamTtlSeconds: 6 * 3600,
  // In-app screener preview (/api/screener/url, /api/gc/screener-url) — NOT the external
  // portal. Cut to 2h from the portal's 6h. A signed URL is a forwardable bearer credential:
  // whoever holds it can fetch for as long as it lives, with no session and no log. The
  // portal's 6h is earned by an OTP-gated, session-bound, revocable, event-logged flow;
  // an in-app fetch has none of that, so it does not get the same window.
  //
  // Not shorter than 2h because CloudFront re-validates every byte-range request, so the
  // TTL must outlast the viewing session or playback dies mid-film. 2h covers a feature
  // plus pauses. The right end state is a much shorter TTL with client-side refresh; that
  // needs player work, so this is the safe interim.
  inAppScreenerTtlSeconds: 2 * 3600,
  sessionCookie: "portal_session",
  // OTP-request abuse caps (rolling 1h window, counted from portal_otps):
  otpPerEmailPerHour: 5, // same (link,email) — bounds resends + the attempts-reset hole
  otpPerLinkPerHour: 20, // one link across all emails — bounds many-address spam
} as const;

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(code: string, linkId: string): string {
  return createHash("sha256").update(`${linkId}:${code}`).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  // Validate as even-length lowercase/uppercase hex BEFORE decoding: Buffer.from(s,"hex")
  // silently truncates at the first invalid or odd-positioned nibble, so without this guard
  // two unequal strings sharing a valid hex prefix (e.g. "abc"/"abd") would compare equal.
  const isHex = (s: string) => s.length % 2 === 0 && /^[0-9a-f]*$/i.test(s);
  if (a.length !== b.length || !isHex(a) || !isHex(b)) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export const PORTAL_COPY = {
  roomTitle: "Secure delivery",
  roomIntro: "Confirm your details to access the file we've sent you.",
  identitySubmit: "Send verification code",
  codePrompt: "Enter the 6-digit code we emailed you.",
  codeSubmit: "Verify",
  downloadPrompt: "Your file is ready.",
  downloadButton: "Download",
  errorExpired: "This link has expired or been withdrawn. Contact your Global Content representative.",
  errorBadCode: "That code is incorrect or has expired. Request a new one.",
  errorTooMany: "Too many attempts. Request a new code.",
  errorChallenge: "Verification failed. Please complete the challenge and try again.",
  errorTooManyRequests: "Too many requests. Please try again later.",
  errorPreparing: "We're retrieving this file from cold storage — this usually takes about 3 to 5 hours. Return to this link and it will be ready.",
  // Neutral 403 fallback (fix round 2, item 2) — used only when a route's 403 body carries no
  // message of its own. In practice every download route sends one, so this is a safety net,
  // not the common path.
  errorDownloadUnavailable: "This file isn't available to download for this title.",
  // 5xx — a fault on GC's side, not a statement about the buyer's access. Reserving
  // errorExpired for actual expiry/revocation means this must exist as its own, honest bucket.
  errorServer: "Something went wrong on our side. Please try again.",
  unknownFilename: "the file",
  screenerHeading: "Screener room",
  screenerIntro: "Confirm your details to view this title.",
  screenerLoading: "Preparing your screener.",
  screenerNotice: "This screening is for evaluation only.",
  unknownTitle: "this title",
  watchButton: "Watch screener",
  downloadScreenerButton: "Download screener",
  // Shown beside Watch when a title can be screened but has nothing downloadable (fix round 2,
  // item 3) — "show the work": silence where a download button would otherwise be reads as a
  // bug, not a deliberate state.
  screenerDownloadUnavailableNotice: "A downloadable screener isn't available for this title.",
  // Buyer-link stream refusal (see /api/portal/screener/route.ts): a named-recipient link on a
  // master-sourced title is refused the stream outright, not just the download — the page
  // must say why rather than leave a dead player, same "show the work" reasoning as the
  // download notice above it.
  screenerStreamUnavailableNotice:
    "This screener isn't available for this link yet. Contact your Global Content representative.",
  downloadMetadataButton: "Download metadata",
  downloadMasterHeading: "Licensed master",
  downloadMasterButton: "Download master",
  downloadMasterNotice: "The full-resolution deliverable for licensed distribution — not the evaluation screener.",
  specificationsHeading: "Specifications",
} as const;

// Fix round 2, task 9, item 2. title-page.tsx used to map EVERY non-409 failure to
// `errorExpired` — "this link has expired or been withdrawn." That's false for a 403 (the
// route's own honest reason, e.g. "available to watch but not to download") and false for a
// 5xx (a server fault, not a statement about the buyer's access) — both are wrong things to
// tell a legitimate buyer on a Tier-3 external surface. `errorExpired` is now reserved for
// the case that's actually true: the session/link itself is gone (401, or any status this
// function doesn't otherwise recognize).
//
// Pure and separately testable from the fetch/parsing plumbing that calls it — the plumbing
// awaits the response body (I/O); this only decides what to SAY once that's in hand.
export function downloadFailureMessage(status: number, bodyError?: string | null): string {
  if (status === 409) return PORTAL_COPY.errorPreparing;
  if (status >= 500) return PORTAL_COPY.errorServer;
  if (status === 403) {
    const trimmed = bodyError?.trim();
    return trimmed ? trimmed : PORTAL_COPY.errorDownloadUnavailable;
  }
  return PORTAL_COPY.errorExpired;
}
