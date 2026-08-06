import { describe, expect, it } from "vitest";

import { stableExpiryEpoch, stableExpiryDate, stableSigningDate } from "./signing-window";

const HOUR = 3600;
const at = (iso: string) => new Date(iso).getTime();

describe("stableExpiryEpoch", () => {
  // The whole point: identical output across a window => identical URL => cache hit.
  it("returns the same value for every instant inside one window", () => {
    const a = stableExpiryEpoch(HOUR, at("2026-08-05T14:00:00Z"));
    const b = stableExpiryEpoch(HOUR, at("2026-08-05T14:17:33Z"));
    const c = stableExpiryEpoch(HOUR, at("2026-08-05T14:59:59Z"));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("advances to a new value in the next window", () => {
    const inside = stableExpiryEpoch(HOUR, at("2026-08-05T14:59:59Z"));
    const next = stableExpiryEpoch(HOUR, at("2026-08-05T15:00:00Z"));
    expect(next).toBeGreaterThan(inside);
    expect(next - inside).toBe(HOUR);
  });

  it("is always at least one full window in the future — never mints a dead URL", () => {
    for (const iso of [
      "2026-08-05T14:00:00Z", // window start
      "2026-08-05T14:30:00Z", // middle
      "2026-08-05T14:59:59Z", // last second — the dangerous edge
    ]) {
      const now = at(iso);
      const remaining = stableExpiryEpoch(HOUR, now) - Math.floor(now / 1000);
      expect(remaining).toBeGreaterThanOrEqual(HOUR);
      expect(remaining).toBeLessThanOrEqual(2 * HOUR);
    }
  });

  it("lands on a clean window boundary", () => {
    expect(stableExpiryEpoch(HOUR, at("2026-08-05T14:23:11Z")) % HOUR).toBe(0);
  });

  it("rejects a non-positive window rather than dividing by zero", () => {
    expect(() => stableExpiryEpoch(0)).toThrow(/positive/);
    expect(() => stableExpiryEpoch(-1)).toThrow(/positive/);
  });
});

describe("stableExpiryDate", () => {
  it("agrees with the epoch form", () => {
    const now = at("2026-08-05T14:23:11Z");
    expect(stableExpiryDate(HOUR, now).getTime()).toBe(stableExpiryEpoch(HOUR, now) * 1000);
  });
});

describe("stableSigningDate", () => {
  it("pins to the START of the window, and is stable across it", () => {
    const a = stableSigningDate(HOUR, at("2026-08-05T14:00:00Z"));
    const b = stableSigningDate(HOUR, at("2026-08-05T14:59:59Z"));
    expect(a.toISOString()).toBe("2026-08-05T14:00:00.000Z");
    expect(a.getTime()).toBe(b.getTime());
  });

  it("moves to the next boundary in the next window", () => {
    expect(stableSigningDate(HOUR, at("2026-08-05T15:00:01Z")).toISOString()).toBe(
      "2026-08-05T15:00:00.000Z",
    );
  });

  it("is never in the future — a signature dated ahead would be rejected", () => {
    const now = at("2026-08-05T14:23:11Z");
    expect(stableSigningDate(HOUR, now).getTime()).toBeLessThanOrEqual(now);
  });
});
