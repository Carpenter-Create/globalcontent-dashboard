import { describe, expect, it } from "vitest";
import { escapeIlikePattern } from "./buyer-names";

describe("escapeIlikePattern", () => {
  it("escapes % so ILIKE treats it as a literal character, not a wildcard", () => {
    expect(escapeIlikePattern("50% Films")).toBe("50\\% Films");
  });
  it("escapes _ so ILIKE treats it as a literal character, not a single-char wildcard", () => {
    expect(escapeIlikePattern("A_B Studios")).toBe("A\\_B Studios");
  });
  // PostgREST (not Postgres) maps an unescaped * to % in a like/ilike filter value before it
  // reaches the database — a buyer literally named "A*B" would otherwise act as a wildcard
  // search in the collision check that calls this. \* is how PostgREST spells a literal
  // asterisk, so the output must be that, not a bare *.
  it("escapes * so PostgREST treats it as a literal character, not its own % alias", () => {
    expect(escapeIlikePattern("A*B Studios")).toBe("A\\*B Studios");
  });
  it("escapes a literal backslash first, so it can't turn an escaped % back into a wildcard", () => {
    expect(escapeIlikePattern("A\\%B")).toBe("A\\\\\\%B");
  });
  it("leaves an ordinary name unchanged", () => {
    expect(escapeIlikePattern("Tubi")).toBe("Tubi");
  });
});
