import { z } from "zod";

/**
 * JSON-safe domain for event payloads and digest inputs.
 * Only: string | finite number | boolean | null | arrays | plain string-keyed objects.
 */

export const FORBIDDEN_JSON_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export type JsonSafe =
  | string
  | number
  | boolean
  | null
  | JsonSafe[]
  | { readonly [key: string]: JsonSafe };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Runtime guard used by zod + canonicalization. */
export function assertJsonSafe(value: unknown, path = "$"): asserts value is JsonSafe {
  if (value === null) return;
  if (typeof value === "string") return;
  if (typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path}: non-finite number`);
    }
    return;
  }
  if (typeof value === "undefined") {
    throw new Error(`${path}: undefined is not JSON-safe`);
  }
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    throw new Error(`${path}: type ${typeof value} is not JSON-safe`);
  }
  if (value instanceof Date) {
    throw new Error(`${path}: Date is not JSON-safe`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertJsonSafe(item, `${path}[${i}]`));
    return;
  }
  if (!isPlainObject(value)) {
    throw new Error(`${path}: only plain objects are JSON-safe`);
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_JSON_KEYS.has(key)) {
      throw new Error(`${path}: forbidden key ${key}`);
    }
    const v = value[key];
    if (v === undefined) {
      throw new Error(`${path}.${key}: undefined is not JSON-safe`);
    }
    assertJsonSafe(v, `${path}.${key}`);
  }
}

export const jsonSafeSchema: z.ZodType<JsonSafe> = z.custom<JsonSafe>(
  (val) => {
    try {
      assertJsonSafe(val);
      return true;
    } catch {
      return false;
    }
  },
  { message: "value is not JSON-safe" },
);

/** Plain object with JSON-safe values; rejects forbidden keys and undefined values. */
export const jsonSafeObjectSchema = z.custom<Record<string, JsonSafe>>(
  (val) => {
    try {
      assertJsonSafe(val);
      return isPlainObject(val);
    } catch {
      return false;
    }
  },
  { message: "payload must be a JSON-safe plain object" },
);
