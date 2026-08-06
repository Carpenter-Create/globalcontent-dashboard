import { describe, expect, it } from "vitest";
import { buyerNameMatches, escapeIlikePattern, normaliseBuyerName } from "./buyer-names";

// These cases are the ones that break in production: a naive `===` on the raw strings misses
// case and whitespace, and a naive ILIKE call without escaping mismatches (or crashes) on `%`
// and `_`. Each is a distinct way the app-side collision check could disagree with the RPC's
// own `lower(btrim(...))` rule and either miss a real collision or manufacture a fake one.
describe("buyerNameMatches", () => {
  it("matches an exact match", () => {
    expect(buyerNameMatches("Tubi", "Tubi")).toBe(true);
  });
  it("matches regardless of case", () => {
    expect(buyerNameMatches("Tubi", "TUBI")).toBe(true);
  });
  it("matches through surrounding whitespace", () => {
    expect(buyerNameMatches("  Tubi ", "Tubi")).toBe(true);
  });
  it("matches a name containing a %", () => {
    expect(buyerNameMatches("50% Films", "50% Films")).toBe(true);
  });
  it("matches a name containing a _", () => {
    expect(buyerNameMatches("A_B Studios", "A_B Studios")).toBe(true);
  });
  it("does not match a genuinely different name", () => {
    expect(buyerNameMatches("Tubi", "Netflix")).toBe(false);
  });
});

describe("normaliseBuyerName", () => {
  it("trims and lowercases, nothing else", () => {
    expect(normaliseBuyerName("  Tubi  ")).toBe("tubi");
  });
});

describe("escapeIlikePattern", () => {
  it("escapes % so ILIKE treats it as a literal character, not a wildcard", () => {
    expect(escapeIlikePattern("50% Films")).toBe("50\\% Films");
  });
  it("escapes _ so ILIKE treats it as a literal character, not a single-char wildcard", () => {
    expect(escapeIlikePattern("A_B Studios")).toBe("A\\_B Studios");
  });
  it("escapes a literal backslash first, so it can't turn an escaped % back into a wildcard", () => {
    expect(escapeIlikePattern("A\\%B")).toBe("A\\\\\\%B");
  });
  it("leaves an ordinary name unchanged", () => {
    expect(escapeIlikePattern("Tubi")).toBe("Tubi");
  });
});
