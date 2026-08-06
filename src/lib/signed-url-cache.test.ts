import { describe, expect, it, beforeEach, vi } from "vitest";

import {
  cachedSignedUrl,
  _resetSignedUrlCache,
  _signedUrlCacheSize,
} from "./signed-url-cache";

beforeEach(() => _resetSignedUrlCache());

describe("cachedSignedUrl", () => {
  it("signs once per key+window — the whole point, since signing is RSA", () => {
    const sign = vi.fn(() => "https://cdn/x?sig=1");
    expect(cachedSignedUrl("key-a", 1000, sign)).toBe("https://cdn/x?sig=1");
    expect(cachedSignedUrl("key-a", 1000, sign)).toBe("https://cdn/x?sig=1");
    expect(cachedSignedUrl("key-a", 1000, sign)).toBe("https://cdn/x?sig=1");
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("re-signs when the window rolls over — self-invalidating, no TTL logic", () => {
    const sign = vi.fn(() => `sig-${Math.random()}`);
    cachedSignedUrl("key-a", 1000, sign);
    cachedSignedUrl("key-a", 2000, sign);
    expect(sign).toHaveBeenCalledTimes(2);
  });

  it("keeps different keys apart — must never serve one asset's URL for another", () => {
    const a = cachedSignedUrl("key-a", 1000, () => "url-a");
    const b = cachedSignedUrl("key-b", 1000, () => "url-b");
    expect(a).toBe("url-a");
    expect(b).toBe("url-b");
  });

  it("does not grow without bound — a long-lived instance would otherwise leak", () => {
    for (let i = 0; i < 2100; i++) cachedSignedUrl(`k${i}`, 1000, () => `u${i}`);
    expect(_signedUrlCacheSize()).toBeLessThanOrEqual(2000);
  });

  it("still returns a correct URL after an eviction", () => {
    for (let i = 0; i < 2100; i++) cachedSignedUrl(`k${i}`, 1000, () => `u${i}`);
    expect(cachedSignedUrl("fresh", 1000, () => "u-fresh")).toBe("u-fresh");
  });
});
