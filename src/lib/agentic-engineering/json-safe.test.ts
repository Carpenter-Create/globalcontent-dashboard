import { describe, expect, it } from "vitest";

import { canonicalJsonString } from "./canonical-json";
import { safeParseControlEvent } from "./event-schema";
import {
  assertJsonSafe,
  jsonSafeObjectSchema,
  jsonSafeSchema,
} from "./json-safe";
import { chainEvents, SAMPLE_DIGEST } from "./test-fixtures";

class Fancy {
  x = 1;
}

describe("json-safe domain", () => {
  it("accepts plain JSON values", () => {
    expect(() =>
      assertJsonSafe({ a: 1, b: "x", c: true, d: null, e: [1, { f: "g" }] }),
    ).not.toThrow();
  });

  it("rejects {decision: undefined}", () => {
    expect(() => assertJsonSafe({ decision: undefined })).toThrow(/undefined/);
    expect(jsonSafeObjectSchema.safeParse({ decision: undefined }).success).toBe(
      false,
    );
  });

  it("rejects Date", () => {
    expect(() => assertJsonSafe({ when: new Date() })).toThrow(/Date/);
  });

  it("rejects class instance", () => {
    expect(() => assertJsonSafe(new Fancy())).toThrow(/plain objects/);
  });

  it("rejects NaN and Infinity", () => {
    expect(() => assertJsonSafe(Number.NaN)).toThrow(/non-finite/);
    expect(() => assertJsonSafe(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
    expect(() => assertJsonSafe(Number.NEGATIVE_INFINITY)).toThrow(/non-finite/);
  });

  it("rejects nested unsupported values", () => {
    expect(() =>
      assertJsonSafe({ outer: { inner: { bad: undefined } } }),
    ).toThrow(/undefined/);
    expect(() => assertJsonSafe({ outer: [new Date()] })).toThrow(/Date/);
  });

  it("rejects __proto__ / constructor / prototype keys", () => {
    expect(() => assertJsonSafe(JSON.parse('{"__proto__":{"x":1}}'))).toThrow(
      /forbidden key/,
    );
    expect(() => assertJsonSafe({ constructor: { x: 1 } })).toThrow(
      /forbidden key/,
    );
    expect(() => assertJsonSafe({ prototype: { x: 1 } })).toThrow(
      /forbidden key/,
    );
  });

  it("{} validates; previously-colliding invalid objects do not", () => {
    expect(jsonSafeSchema.safeParse({}).success).toBe(true);
    expect(jsonSafeSchema.safeParse({ decision: undefined }).success).toBe(
      false,
    );
    expect(jsonSafeSchema.safeParse(new Fancy()).success).toBe(false);
    expect(jsonSafeSchema.safeParse({ when: new Date() }).success).toBe(false);
  });

  it("canonicalization rejects undefined rather than dropping it", () => {
    expect(() => canonicalJsonString({ a: 1, b: undefined })).toThrow(
      /undefined/,
    );
  });

  it("same logical value hashes identically via canonical JSON", () => {
    const a = canonicalJsonString({ z: 1, a: { b: 2, a: 3 } });
    const b = canonicalJsonString({ a: { a: 3, b: 2 }, z: 1 });
    expect(a).toBe(b);
  });

  it("distinct accepted values do not collapse", () => {
    expect(canonicalJsonString({ a: 1 })).not.toBe(canonicalJsonString({ a: 2 }));
    expect(canonicalJsonString({ a: null })).not.toBe(
      canonicalJsonString({ a: 0 }),
    );
  });

  it("authority event schema rejects empty validation_completed payload", () => {
    const [base] = chainEvents([{ type: "contract_staged" }]);
    const bad = {
      ...base,
      event_type: "validation_completed",
      payload: {},
    };
    expect(safeParseControlEvent(bad).success).toBe(false);
  });

  it("authority event schema rejects empty review_completed payload", () => {
    const [base] = chainEvents([{ type: "contract_staged" }]);
    const bad = {
      ...base,
      event_type: "review_completed",
      payload: {},
    };
    expect(safeParseControlEvent(bad).success).toBe(false);
  });

  it("contract_staged empty {} is rejected (no silent collapse)", () => {
    const [base] = chainEvents([{ type: "contract_staged" }]);
    const bad = { ...base, payload: {} };
    expect(safeParseControlEvent(bad).success).toBe(false);
    const good = {
      ...base,
      payload: {
        contract_version: 1,
        contract_digest: SAMPLE_DIGEST,
      },
    };
    // digest may not match but schema shape is valid
    const parsed = safeParseControlEvent(good);
    expect(parsed.success).toBe(true);
  });
});
