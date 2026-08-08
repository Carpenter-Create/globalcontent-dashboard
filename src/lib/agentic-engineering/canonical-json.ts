import { assertJsonSafe, FORBIDDEN_JSON_KEYS, type JsonSafe } from "./json-safe";

/**
 * Deterministic JSON serialization for event digests (spec §4.5.4).
 *
 * - UTF-8
 * - object keys sorted lexicographically
 * - arrays preserve supplied order
 * - compact JSON (no insignificant whitespace)
 * - null-prototype containers during construction (no prototype mutation)
 * - undefined / non-JSON-safe values rejected (never silently dropped)
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonSafe;

export function omitKeys(
  obj: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const drop = new Set(keys);
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_JSON_KEYS.has(key)) {
      throw new Error(`forbidden key in omitKeys: ${key}`);
    }
    if (!drop.has(key)) {
      out[key] = obj[key];
    }
  }
  return out;
}

function canonicalize(value: unknown): JsonSafe {
  assertJsonSafe(value);
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") return value;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  // plain object
  const keys = Object.keys(value as object).sort();
  const out = Object.create(null) as Record<string, JsonSafe>;
  for (const key of keys) {
    out[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  // Return a plain object snapshot with null prototype for stringify stability
  return out as JsonSafe;
}

/** Compact deterministic JSON string (UTF-8 when encoded). */
export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJsonString(value), "utf8");
}
