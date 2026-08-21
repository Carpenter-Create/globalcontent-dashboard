import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { parseAskGlobeeInk, stackAskGlobeeInkFacts } from "./ask-globee-ink";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ask-globee-ink.ts"), "utf8");

function visible(text: string): string {
  return parseAskGlobeeInk(text)
    .map((span) => span.text)
    .join("");
}

describe("askGlobee conversation ink", () => {
  it("turns **markdown** and catalog field names into Medium and drops the stars", () => {
    expect(parseAskGlobeeInk("Harbor Cut is missing **Genre**.")).toEqual([
      { text: "Harbor Cut is missing ", medium: false },
      { text: "Genre", medium: true },
      { text: ".", medium: false },
    ]);
    expect(parseAskGlobeeInk("Synopsis is required.")).toEqual([
      { text: "Synopsis", medium: true },
      { text: " is required.", medium: false },
    ]);
    expect(visible("Harbor Cut is missing **Genre**.")).toBe("Harbor Cut is missing Genre.");
    expect(visible("Harbor Cut is missing **Genre**.")).not.toContain("**");
  });

  it("stacks live lead/follow and strips bullets, hashes, and backticks from visible ink", () => {
    expect(
      stackAskGlobeeInkFacts(
        "Harbor Cut is missing **Genre**.",
        "- Genre is required before it can go live.\n# Synopsis and `Runtime` are also required.",
      ),
    ).toEqual([
      "Harbor Cut is missing **Genre**.",
      "Genre is required before it can go live.",
      "Synopsis and Runtime are also required.",
    ]);

    const hashed = parseAskGlobeeInk("# Synopsis is required.");
    expect(hashed).toEqual([
      { text: "Synopsis", medium: true },
      { text: " is required.", medium: false },
    ]);
    expect(visible("# Synopsis is required.")).toBe("Synopsis is required.");
    expect(visible("`Genre` is required.")).toBe("Genre is required.");
    expect(visible("- Director is recommended.")).toBe("Director is recommended.");
    expect(visible("# Synopsis and `Runtime` are also required.")).not.toMatch(/[*#`]/);
    expect(src).not.toContain("Winter Line");
    expect(src).not.toContain("Harbor Lights");
  });

  it("keeps Winter Line fixture copy as an input, never a baked product title", () => {
    const facts = stackAskGlobeeInkFacts(ASK_GLOBEE.answerLead, ASK_GLOBEE.answerFollow);
    expect(facts.join(" ")).toContain("Genre");
    expect(facts.join(" ")).toContain("Synopsis");
    expect(src).not.toContain(ASK_GLOBEE.answerLead);
    expect(src).not.toContain("The Winter Line");
  });
});
