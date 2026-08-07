import { describe, expect, it } from "vitest";
import { escapeIlikePattern } from "./buyer-names";

describe("escapeIlikePattern", () => {
  it("escapes % so ILIKE treats it as a literal character, not a wildcard", () => {
    expect(escapeIlikePattern("50% Films")).toBe("50\\% Films");
  });
  it("escapes _ so ILIKE treats it as a literal character, not a single-char wildcard", () => {
    expect(escapeIlikePattern("A_B Studios")).toBe("A\\_B Studios");
  });
  // PostgREST (not Postgres) maps an unescaped * to % in a like/ilike filter value AFTER this
  // function runs — a plain character substitution with no escape awareness. So escaping *
  // to \* here would arrive at Postgres as \%, a literal PERCENT SIGN, not a literal asterisk:
  // the collision pattern would then match nothing, the check would find no collision, and
  // create_screener_link would silently revoke a live link already emailed to a buyer named
  // "A*B Studios". Leaving * unescaped keeps it a wildcard, which only over-matches (a
  // harmless spurious warning) — the safe direction, since under-matching silently kills a
  // link. Pinning the reverted behaviour: * must pass through untouched.
  it("leaves * untouched — escaping it would silently kill a live link, not protect one", () => {
    expect(escapeIlikePattern("A*B Studios")).toBe("A*B Studios");
  });
  it("escapes a literal backslash first, so it can't turn an escaped % back into a wildcard", () => {
    expect(escapeIlikePattern("A\\%B")).toBe("A\\\\\\%B");
  });
  it("leaves an ordinary name unchanged", () => {
    expect(escapeIlikePattern("Tubi")).toBe("Tubi");
  });
});
