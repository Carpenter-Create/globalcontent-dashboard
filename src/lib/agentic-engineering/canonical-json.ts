/**
 * Deterministic JSON serialization for event digests (spec §4.5.4).
 *
 * Rules:
 * - UTF-8
 * - object keys sorted lexicographically at every nesting level
 * - arrays preserve supplied element order
 * - no insignificant whitespace (compact JSON)
 * - LF not used (JSON.stringify produces no newlines)
 * - excludes caller-selected keys (typically `event_digest`) before serialize
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export function omitKeys<T extends Record<string, unknown>>(
  obj: T,
  keys: readonly string[],
): Record<string, unknown> {
  const drop = new Set(keys);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!drop.has(k)) out[k] = v;
  }
  return out;
}

function canonicalize(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON rejects non-finite numbers");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    const out: JsonObject = {};
    for (const key of keys) {
      const v = rec[key];
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  throw new Error(`canonical JSON rejects type ${typeof value}`);
}

/** Compact deterministic JSON string (UTF-8 when encoded). */
export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJsonString(value), "utf8");
}
