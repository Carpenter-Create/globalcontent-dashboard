import { describe, expect, it } from "vitest";
import {
  PORTAL,
  PORTAL_COPY,
  generateToken,
  hashToken,
  generateOtpCode,
  hashOtp,
  safeEqualHex,
  downloadFailureMessage,
} from "./portal";

describe("portal crypto", () => {
  it("generates distinct URL-safe tokens", () => {
    const a = generateToken(), b = generateToken();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });
  it("hashToken is stable and 64-hex", () => {
    expect(hashToken("abc")).toEqual(hashToken("abc"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("otp code is 6 digits", () => {
    for (let i = 0; i < 50; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });
  it("hashOtp is salted by linkId", () => {
    expect(hashOtp("123456", "link-1")).not.toEqual(hashOtp("123456", "link-2"));
    expect(hashOtp("123456", "link-1")).toEqual(hashOtp("123456", "link-1"));
  });
  it("safeEqualHex compares equal-length hex", () => {
    expect(safeEqualHex(hashToken("x"), hashToken("x"))).toBe(true);
    expect(safeEqualHex(hashToken("x"), hashToken("y"))).toBe(false);
    expect(safeEqualHex("aa", "aabb")).toBe(false);
    // unequal strings sharing a hex prefix must NOT compare equal (hex-truncation guard)
    expect(safeEqualHex("abc", "abd")).toBe(false); // odd-length rejected
    expect(safeEqualHex("aabbccxx", "aabbccyy")).toBe(false); // non-hex rejected
  });
  it("PORTAL constants match spec", () => {
    expect(PORTAL.otpTtlMinutes).toBe(10);
    expect(PORTAL.otpMaxAttempts).toBe(5);
    expect(PORTAL.sessionTtlHours).toBe(24);
  });
});

// Fix round 2, item 2: title-page.tsx used to tell every non-409 failure "this link has
// expired or been withdrawn" — false for a 403 refusal and false for a 5xx server fault.
describe("downloadFailureMessage", () => {
  it("maps 409 to the cold-storage message", () => {
    expect(downloadFailureMessage(409)).toBe(PORTAL_COPY.errorPreparing);
  });

  it("maps any 5xx to the generic server-fault message, never 'expired'", () => {
    expect(downloadFailureMessage(500)).toBe(PORTAL_COPY.errorServer);
    expect(downloadFailureMessage(503)).toBe(PORTAL_COPY.errorServer);
  });

  it("shows the route's own 403 message when present", () => {
    expect(downloadFailureMessage(403, "This file is available to watch but not to download for this title."))
      .toBe("This file is available to watch but not to download for this title.");
  });

  it("falls back to a neutral message on a 403 with no body error", () => {
    expect(downloadFailureMessage(403)).toBe(PORTAL_COPY.errorDownloadUnavailable);
    expect(downloadFailureMessage(403, "")).toBe(PORTAL_COPY.errorDownloadUnavailable);
    expect(downloadFailureMessage(403, "   ")).toBe(PORTAL_COPY.errorDownloadUnavailable);
  });

  it("reserves errorExpired for everything else (401 no-session, or an unrecognized status)", () => {
    expect(downloadFailureMessage(401)).toBe(PORTAL_COPY.errorExpired);
    expect(downloadFailureMessage(404)).toBe(PORTAL_COPY.errorExpired);
  });
});
