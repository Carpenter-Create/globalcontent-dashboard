import { describe, expect, it, vi, beforeEach } from "vitest";

// headObjectMeta constructs its own S3Client internally and is not given one to inject, so the
// only way to control what a HeadObject call "returns" is to mock the SDK client itself.
// `importOriginal` keeps every real export (HeadObjectCommand etc.) intact — s3.ts does
// `new HeadObjectCommand(...)`, which would break if the whole module were replaced.
const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  // s3.ts does `new S3Client(...)` — an arrow function can't be called as a constructor, so
  // this needs a real function/class, not `vi.fn().mockImplementation(() => ...)`.
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(function S3ClientMock() {
      return { send: mockSend };
    }),
  };
});

import { parseRestore, headObjectMeta } from "./s3";

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

// Fix round 1, item 3: headObjectMeta's 404-vs-everything-else discrimination previously had
// NO test at all, despite being the single branch that decides whether a transcode job gets
// permanently failed. Table-driven per the review's minimum bar, plus the two defects it found.
describe("headObjectMeta", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("the SDK's own modeled NotFound (a confirmed-absent object) resolves to null", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }),
    );
    await expect(headObjectMeta("orgs/o/titles/t/screener/u/x.mp4")).resolves.toBeNull();
  });

  it("a 403 Forbidden (e.g. missing s3:ListBucket, so S3 hides existence rather than saying 404) throws — never null", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { name: "Forbidden", $metadata: { httpStatusCode: 403 } }),
    );
    await expect(headObjectMeta("orgs/o/titles/t/screener/u/x.mp4")).rejects.toThrow("Forbidden");
  });

  // The specific regression this fix round closed: a bare `statusCode === 404` fallback used
  // to treat ANY 404-shaped error as "absent," including one whose name is something other
  // than the SDK's own "NotFound" (e.g. a wrong/renamed bucket surfacing as this shape).
  // Narrowing to `name === "NotFound"` only means a 404 that isn't that exact modeled
  // exception now throws instead of silently registering as "confirmed absent."
  it("a 404-shaped error that is NOT the SDK's modeled NotFound (e.g. a misconfigured bucket) throws, not null", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("NoSuchBucket"), { name: "NoSuchBucket", $metadata: { httpStatusCode: 404 } }),
    );
    await expect(headObjectMeta("orgs/o/titles/t/screener/u/x.mp4")).rejects.toThrow("NoSuchBucket");
  });

  it("a successful HeadObject returns bytes and an unquoted ETag", async () => {
    mockSend.mockResolvedValueOnce({ ContentLength: 4096, ETag: '"abc123"' });
    await expect(headObjectMeta("orgs/o/titles/t/screener/u/x.mp4")).resolves.toEqual({
      bytes: 4096,
      etag: "abc123",
    });
  });
});
