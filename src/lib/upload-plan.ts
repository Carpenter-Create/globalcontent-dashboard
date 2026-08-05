// Multipart upload planning — pure, so the byte arithmetic is testable away from
// fetch and React. A boundary bug here does not throw: it silently assembles a
// corrupt master that only surfaces as a vendor rejection weeks later.

export type PartPlan = { partNumber: number; start: number; end: number };

/** S3 caps a multipart upload at 10,000 parts. */
export const MAX_PARTS = 10_000;

/** Contiguous 1-indexed parts covering [0, fileSize) exactly once. */
export function planParts(fileSize: number, partSize: number): PartPlan[] {
  if (partSize <= 0) throw new Error("partSize must be positive");
  if (fileSize <= 0) return [];
  const count = Math.ceil(fileSize / partSize);
  if (count > MAX_PARTS) {
    throw new Error(`file needs ${count} parts, over S3's ${MAX_PARTS} limit`);
  }
  return Array.from({ length: count }, (_, i) => ({
    partNumber: i + 1,
    start: i * partSize,
    end: Math.min((i + 1) * partSize, fileSize),
  }));
}

/**
 * Split parts into signing windows. Each window is signed in ONE round-trip and
 * uploaded before the next is signed, so a long upload never holds a presigned URL
 * past its TTL.
 */
export function planWindows(parts: PartPlan[], windowSize: number): PartPlan[][] {
  if (windowSize <= 0) throw new Error("windowSize must be positive");
  const out: PartPlan[][] = [];
  for (let i = 0; i < parts.length; i += windowSize) {
    out.push(parts.slice(i, i + windowSize));
  }
  return out;
}
