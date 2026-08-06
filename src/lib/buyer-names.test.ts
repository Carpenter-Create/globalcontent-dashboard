import { describe, expect, it } from "vitest";
import { buyerNameMatches, escapeIlikePattern, normaliseBuyerName } from "./buyer-names";

// The case/whitespace cases here are the ones that break in production for a naive `===` on
// the raw strings: 'Tubi' and ' tubi ' are the same buyer under the RPC's rule but not under
// plain equality. The `%`/`_` cases below only confirm plain-string equality is unaffected by
// those characters — they say NOTHING about ILIKE escaping (buyerNameMatches never builds a
// SQL pattern). The escaping hazard — a literal `%` or `_` turning into a wildcard — is real
// but lives entirely in escapeIlikePattern, tested in its own block further down.
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
