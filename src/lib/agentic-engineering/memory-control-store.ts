import {
  assertControlPaths,
  cloneObjects,
  tipForObjects,
  type ControlObjects,
  type ControlSnapshot,
  type ControlStore,
  type ControlTip,
} from "./control-store";
import { registerWritableControlStore } from "./internal/writable-registry";

/**
 * Create an in-memory control store for dry-run / tests.
 * Returns the public read-only ControlStore surface; writes go only through
 * the trusted ledger writer via an internal registry.
 */
export function createMemoryControlStore(
  initial?: ControlObjects,
): ControlStore {
  let tip: ControlTip = tipForObjects(initial ? cloneObjects(initial) : new Map());
  let objects: Map<string, string> = initial
    ? cloneObjects(initial)
    : new Map();

  const store: ControlStore = {
    async getTip(): Promise<ControlTip> {
      return tip;
    },
    async getSnapshot(): Promise<ControlSnapshot> {
      return { tip, objects: cloneObjects(objects) };
    },
    async readObject(path: string): Promise<string | null> {
      return objects.get(path) ?? null;
    },
  };

  registerWritableControlStore(store, {
    async unsafeCompareAndSwap(expectedTip, nextObjects) {
      if (tip !== expectedTip) {
        return {
          ok: false,
          code: "stale_tip",
          message: "expected tip does not match current tip",
          observedTip: tip,
        };
      }
      const pathErr = assertControlPaths(nextObjects);
      if (pathErr) {
        return {
          ok: false,
          code: "invalid_path",
          message: pathErr,
          observedTip: tip,
        };
      }
      objects = cloneObjects(nextObjects);
      tip = tipForObjects(objects);
      return {
        ok: true,
        tip,
        objects: cloneObjects(objects),
      };
    },
  });

  return store;
}
