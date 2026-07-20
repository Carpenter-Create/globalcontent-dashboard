import { describe, expect, it } from "vitest";
import { parseRestore } from "./s3";

describe("parseRestore", () => {
  it("non-archived storage class is immediately available", () => {
    expect(parseRestore(undefined, undefined)).toBe("available"); // S3 omits class for STANDARD
    expect(parseRestore(undefined, "STANDARD")).toBe("available");
  });
  it("archived with no restore header → none", () => {
    expect(parseRestore(undefined, "GLACIER")).toBe("none");
    expect(parseRestore(undefined, "DEEP_ARCHIVE")).toBe("none");
  });
  it("restore in progress → restoring", () => {
    expect(parseRestore('ongoing-request="true"', "GLACIER")).toBe("restoring");
  });
  it("restore complete → available", () => {
    expect(
      parseRestore('ongoing-request="false", expiry-date="Wed, 30 Jul 2026 00:00:00 GMT"', "GLACIER"),
    ).toBe("available");
  });
});
