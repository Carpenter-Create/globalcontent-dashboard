import { describe, expect, it } from "vitest";
import {
  PORTAL,
  generateToken,
  hashToken,
  generateOtpCode,
  hashOtp,
  safeEqualHex,
  requestOtpBodySchema,
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

describe("requestOtpBodySchema", () => {
  const base = { token: "a".repeat(20), email: "buyer@example.com", turnstileToken: "tok" };

  // The regression this pins: a buyer who leaves both fields blank — exactly what the task
  // brief's manual-check step instructs a tester to do — must not get rejected. Before this
  // fix, name/company were `min(1)`, so this parse failed with no signal from a green suite.
  it("parses with name and company entirely absent", () => {
    const r = requestOtpBodySchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBeNull();
      expect(r.data.company).toBeNull();
    }
  });

  // The client always sends the keys (React state defaults to ""), never omits them — so
  // blank-string input must collapse to null too, not just a genuinely-missing key.
  it("collapses blank or whitespace-only name/company to null, not empty string", () => {
    const r = requestOtpBodySchema.safeParse({ ...base, name: "   ", company: "" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBeNull();
      expect(r.data.company).toBeNull();
    }
  });

  it("trims and keeps a provided name/company", () => {
    const r = requestOtpBodySchema.safeParse({ ...base, name: " Jane Buyer ", company: " Acme " });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Jane Buyer");
      expect(r.data.company).toBe("Acme");
    }
  });

  it("fails without an email — the only required identity field", () => {
    expect(
      requestOtpBodySchema.safeParse({ token: base.token, turnstileToken: base.turnstileToken }).success,
    ).toBe(false);
  });

  it("fails without a token", () => {
    expect(
      requestOtpBodySchema.safeParse({ email: base.email, turnstileToken: base.turnstileToken }).success,
    ).toBe(false);
  });
});
