import { describe, expect, it } from "vitest";

import { MAX_PARTS, planParts, planWindows } from "./upload-plan";

const MIB = 1024 * 1024;
const PART = 64 * MIB; // matches PART_SIZE in lib/assets

// The invariant that matters: the parts must tile the file exactly. Overlap
// duplicates bytes, a gap truncates — and neither throws. The upload "succeeds"
// and the master is quietly wrong.
function assertTiles(fileSize: number, partSize: number) {
  const parts = planParts(fileSize, partSize);
  expect(parts[0].start).toBe(0);
  expect(parts[parts.length - 1].end).toBe(fileSize);
  for (let i = 1; i < parts.length; i++) {
    expect(parts[i].start).toBe(parts[i - 1].end); // no gap, no overlap
  }
  const covered = parts.reduce((n, p) => n + (p.end - p.start), 0);
  expect(covered).toBe(fileSize);
  expect(parts.map((p) => p.partNumber)).toEqual(parts.map((_, i) => i + 1));
}

describe("planParts", () => {
  it("tiles a file smaller than one part", () => assertTiles(5 * MIB, PART));
  it("tiles a file exactly one part", () => assertTiles(PART, PART));
  it("tiles one byte over a part boundary", () => assertTiles(PART + 1, PART));
  it("tiles one byte under a part boundary", () => assertTiles(PART - 1, PART));
  it("tiles an exact multiple of the part size", () => assertTiles(4 * PART, PART));
  it("tiles a realistic 20 GB master", () => assertTiles(20 * 1024 * MIB, PART));

  it("is 1-indexed — S3 rejects part 0", () => {
    expect(planParts(3 * PART, PART)[0].partNumber).toBe(1);
  });

  it("returns no parts for an empty file", () => {
    expect(planParts(0, PART)).toEqual([]);
  });

  it("rejects a non-positive part size rather than looping forever", () => {
    expect(() => planParts(MIB, 0)).toThrow(/positive/);
  });

  it("refuses a file that would exceed S3's 10,000-part cap", () => {
    expect(() => planParts((MAX_PARTS + 1) * MIB, MIB)).toThrow(/10000|10,000/);
  });

  it("allows a file exactly at the cap", () => {
    expect(planParts(MAX_PARTS * MIB, MIB)).toHaveLength(MAX_PARTS);
  });
});

describe("planWindows", () => {
  it("preserves every part, in order, across windows", () => {
    const parts = planParts(10 * PART, PART);
    const windows = planWindows(parts, 3);
    expect(windows.map((w) => w.length)).toEqual([3, 3, 3, 1]);
    expect(windows.flat()).toEqual(parts);
  });

  it("returns one window when it is larger than the part count", () => {
    const parts = planParts(2 * PART, PART);
    expect(planWindows(parts, 25)).toEqual([parts]);
  });

  it("returns nothing for no parts", () => {
    expect(planWindows([], 25)).toEqual([]);
  });

  it("rejects a non-positive window size rather than looping forever", () => {
    expect(() => planWindows(planParts(PART, PART), 0)).toThrow(/positive/);
  });
});
