import { createHash } from "node:crypto";

import { canonicalJsonString } from "./canonical-json";
import { digestUtf8Bytes } from "./contract-digest";
import { parseControlPath } from "./control-paths";

/** Opaque tip identity for the control ledger (content-addressed). */
export type ControlTip = string;

export type ControlObjects = ReadonlyMap<string, string>;

export type ControlSnapshot = {
  tip: ControlTip;
  objects: ControlObjects;
};

export type CasFailureCode =
  | "stale_tip"
  | "invalid_path"
  | "integrity_failure"
  | "lock_busy"
  | "internal_error";

export type CasResult =
  | { ok: true; tip: ControlTip; objects: ControlObjects }
  | {
      ok: false;
      code: CasFailureCode;
      message: string;
      observedTip?: ControlTip;
    };

export class LedgerIntegrityError extends Error {
  readonly code = "integrity_failure" as const;
  constructor(message: string) {
    super(message);
    this.name = "LedgerIntegrityError";
  }
}

/**
 * Read-only repository-like view of the conceptual ae/control object set.
 * Public callers must not replace the ledger wholesale.
 */
export interface ControlStore {
  getTip(): Promise<ControlTip>;
  /** Fail closed on corruption / tip mismatch / unknown paths. */
  getSnapshot(): Promise<ControlSnapshot>;
  readObject(path: string): Promise<string | null>;
}

/**
 * Internal mutable store used only by the trusted control-ledger writer.
 * Not for CLI / GitHub boundary / general callers.
 */
export interface MutableControlStore extends ControlStore {
  /**
   * @internal Unsafe whole-set CAS after ledger has already validated
   * protected-delta + chain + fold. Do not call from public surfaces.
   */
  unsafeCompareAndSwap(
    expectedTip: ControlTip,
    nextObjects: Map<string, string>,
  ): Promise<CasResult>;
}

/** Empty ledger tip (no objects). */
export const EMPTY_CONTROL_TIP = tipForObjects(new Map());

export function tipForObjects(objects: ControlObjects): ControlTip {
  const entries = [...objects.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const material = entries.map(([path, content]) => ({
    path,
    digest: digestUtf8Bytes(content),
  }));
  const hex = createHash("sha256")
    .update(canonicalJsonString(material), "utf8")
    .digest("hex");
  return `tip:${hex}`;
}

export function assertControlPaths(objects: ControlObjects): string | null {
  for (const path of objects.keys()) {
    const parsed = parseControlPath(path);
    if (!parsed.ok) return `${path}: ${parsed.reason}`;
  }
  return null;
}

export function cloneObjects(objects: ControlObjects): Map<string, string> {
  return new Map(objects);
}

export function contentDigestMap(objects: ControlObjects): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, content] of objects) {
    out.set(path, digestUtf8Bytes(content));
  }
  return out;
}

export function isMutableControlStore(
  store: ControlStore,
): store is MutableControlStore {
  return (
    typeof (store as MutableControlStore).unsafeCompareAndSwap === "function"
  );
}
