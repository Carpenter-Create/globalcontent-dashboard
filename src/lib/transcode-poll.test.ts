import { describe, expect, it } from "vitest";
import { resolveJobOutcome } from "@/lib/transcode-poll";

describe("resolveJobOutcome", () => {
  it("maps MediaConvert's terminal states", () => {
    expect(resolveJobOutcome("COMPLETE")).toBe("complete");
    expect(resolveJobOutcome("ERROR")).toBe("failed");
    expect(resolveJobOutcome("CANCELED")).toBe("failed");
  });

  it("leaves non-terminal or unrecognised states alone", () => {
    expect(resolveJobOutcome("PROGRESSING")).toBeNull();
    expect(resolveJobOutcome("SUBMITTED")).toBeNull();
    expect(resolveJobOutcome("something-unexpected")).toBeNull();
  });

  // Pinning extra cases beyond the brief: a malformed/missing GetJob response must not be
  // mistaken for a terminal state either direction.
  it("treats a missing status as non-terminal rather than throwing or failing the job", () => {
    expect(resolveJobOutcome(undefined)).toBeNull();
    expect(resolveJobOutcome(null)).toBeNull();
    expect(resolveJobOutcome("")).toBeNull();
  });

  it("is case-sensitive — MediaConvert's real statuses are all-caps, and a lowercase echo is not one of them", () => {
    expect(resolveJobOutcome("complete")).toBeNull();
    expect(resolveJobOutcome("error")).toBeNull();
  });
});
