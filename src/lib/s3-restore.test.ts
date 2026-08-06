import { describe, expect, it } from "vitest";

import { parseRestore } from "./s3";

// The failure this guards against is silent and expensive: if an archived object is judged
// "available", the app signs a URL, hands it to a client or a vendor, and the download 403s
// with no explanation. Worse for a screener, where playback simply dies mid-session.

describe("parseRestore — classic Glacier classes", () => {
  it("STANDARD (reported as undefined) is available", () => {
    expect(parseRestore(undefined, undefined)).toBe("available");
  });

  it("GLACIER with no restore header needs a restore", () => {
    expect(parseRestore(undefined, "GLACIER")).toBe("none");
  });

  it("restore in flight", () => {
    expect(parseRestore('ongoing-request="true"', "GLACIER")).toBe("restoring");
  });

  it("restore complete is servable", () => {
    expect(
      parseRestore('ongoing-request="false", expiry-date="Fri, 01 Jan 2027 00:00:00 GMT"', "DEEP_ARCHIVE"),
    ).toBe("available");
  });
});

describe("parseRestore — Intelligent-Tiering", () => {
  // INTELLIGENT_TIERING reports the SAME storage class in every tier; the tier lives in a
  // separate ArchiveStatus header. Checking storageClass alone — which the original code
  // did — calls an archived master "available" and breaks the download.
  it("automatic tiers are instant: no ArchiveStatus means available", () => {
    expect(parseRestore(undefined, "INTELLIGENT_TIERING")).toBe("available");
    expect(parseRestore(undefined, "INTELLIGENT_TIERING", undefined)).toBe("available");
  });

  it("ARCHIVE_ACCESS is NOT available — this is the bug", () => {
    expect(parseRestore(undefined, "INTELLIGENT_TIERING", "ARCHIVE_ACCESS")).toBe("none");
  });

  it("DEEP_ARCHIVE_ACCESS is NOT available", () => {
    expect(parseRestore(undefined, "INTELLIGENT_TIERING", "DEEP_ARCHIVE_ACCESS")).toBe("none");
  });

  it("reports restoring while an archived-tier restore runs", () => {
    expect(
      parseRestore('ongoing-request="true"', "INTELLIGENT_TIERING", "DEEP_ARCHIVE_ACCESS"),
    ).toBe("restoring");
  });

  it("reports available once that restore completes", () => {
    expect(
      parseRestore('ongoing-request="false", expiry-date="x"', "INTELLIGENT_TIERING", "ARCHIVE_ACCESS"),
    ).toBe("available");
  });

  it("an unrecognised ArchiveStatus does not archive-lock an instant object", () => {
    // Fail toward servable: a new tier name we do not know about should not make every
    // master permanently unreachable.
    expect(parseRestore(undefined, "INTELLIGENT_TIERING", "SOMETHING_NEW")).toBe("available");
  });
});
