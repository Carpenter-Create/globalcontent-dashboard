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
  unknownFilename: "the file",
  screenerHeading: "Screener room",
  screenerIntro: "Confirm your details to view this title.",
  screenerLoading: "Preparing your screener.",
  screenerNotice: "This screening is for evaluation only.",
  unknownTitle: "this title",
  watchButton: "Watch screener",
  downloadScreenerButton: "Download screener",
  downloadMetadataButton: "Download metadata",
  downloadMasterHeading: "Licensed master",
  downloadMasterButton: "Download master",
  downloadMasterNotice: "The full-resolution deliverable for licensed distribution — not the evaluation screener.",
  specificationsHeading: "Specifications",
} as const;
