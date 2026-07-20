import { describe, expect, it } from "vitest";
import { PORTAL, generateToken, hashToken, generateOtpCode, hashOtp, safeEqualHex } from "./portal";

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
