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
//
// Fix round 2, item 2: headObjectMeta now issues a SECOND call (HeadBucket) on the NotFound
// path only, to disambiguate a missing key from a missing/inaccessible bucket. Every test
// below that expects `null` now supplies both queued responses explicitly (HeadObject's
// NotFound, then HeadBucket's success) rather than relying on vitest's default post-reset
// mock behavior (a bare `vi.fn()` resolves to `undefined` when no implementation is queued,
// which would happen to also not throw — accidentally passing for the wrong reason).
describe("headObjectMeta", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("HeadObject NotFound + HeadBucket reachable: the bucket is fine, the KEY is genuinely absent → null", async () => {
    mockSend
      .mockRejectedValueOnce(Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }))
      .mockResolvedValueOnce({}); // HeadBucket succeeds
    await expect(headObjectMeta("orgs/o/titles/t/screener/u/x.mp4")).resolves.toBeNull();
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  // Fix round 2, item 2 — the case fix round 1 could not close: AWS's HeadObject 404 is
  // identical whether the KEY or the BUCKET is missing. HeadBucket, run on the bucket alone,
  // tells them apart. A bucket that itself 404s/403s means the ORIGINAL NotFound was never a
  // confirmed-absent key — it must throw ("could not tell"), not return null ("confirmed
  // absent"), or a misconfigured bucket would permanently fail every in-flight job on first
  // observation instead of being retried until someone notices the real problem.
  it("HeadObject NotFound + HeadBucket ALSO fails: the bucket itself is the problem — throws, never null", async () => {
    mockSend
      .mockRejectedValueOnce(Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }))
      .mockRejectedValueOnce(Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } })); // HeadBucket 404s too
    await expect(headObjectMeta("orgs/o/titles/t/screener/u/x.mp4")).rejects.toThrow(/not accessible/);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("a 403 Forbidden (e.g. missing s3:ListBucket, so S3 hides existence rather than saying 404) throws — never null, and never reaches HeadBucket", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { name: "Forbidden", $metadata: { httpStatusCode: 403 } }),
    );
    await expect(headObjectMeta("orgs/o/titles/t/screener/u/x.mp4")).rejects.toThrow("Forbidden");
    // Only the name === "NotFound" path triggers the HeadBucket disambiguation — a 403 is
    // already unambiguous (we could not tell), so there's nothing for a second call to resolve.
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  // The specific regression fix round 1 closed: a bare `statusCode === 404` fallback used to
  // treat ANY 404-shaped error as "absent," including one whose name is something other than
  // the SDK's own "NotFound". This is a SYNTHETIC case, not a shape a real HeadObject call can
  // produce (a real missing-bucket 404 on HeadObject is ALSO named "NotFound" by the SDK — see
  // the module comment) — it exists purely to pin that the narrowed `name === "NotFound"`
  // check still rejects any OTHER exception name at a 404 status, rather than trusting the
  // status code alone. The real missing-bucket case is covered by the HeadBucket tests above.
  it("a 404-shaped error with a DIFFERENT name than the SDK's modeled NotFound throws, not null (defensive — not a real HeadObject shape)", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("SomeOtherName"), { name: "SomeOtherName", $metadata: { httpStatusCode: 404 } }),
    );
    await expect(headObjectMeta("orgs/o/titles/t/screener/u/x.mp4")).rejects.toThrow("SomeOtherName");
    expect(mockSend).toHaveBeenCalledTimes(1); // not "NotFound" — no HeadBucket disambiguation attempted
  });

  it("a successful HeadObject returns bytes and an unquoted ETag, with no HeadBucket call at all", async () => {
    mockSend.mockResolvedValueOnce({ ContentLength: 4096, ETag: '"abc123"' });
    await expect(headObjectMeta("orgs/o/titles/t/screener/u/x.mp4")).resolves.toEqual({
      bytes: 4096,
      etag: "abc123",
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
