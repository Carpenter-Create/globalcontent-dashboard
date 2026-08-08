import type {
  CasResult,
  ControlStore,
  ControlTip,
} from "../control-store";

/**
 * Module-private writable handle. Not exported from package index.
 * Only the trusted control-ledger writer may obtain this.
 */
export type WritableControlOps = {
  unsafeCompareAndSwap(
    expectedTip: ControlTip,
    nextObjects: Map<string, string>,
  ): Promise<CasResult>;
};

const writers = new WeakMap<ControlStore, WritableControlOps>();

export function registerWritableControlStore(
  store: ControlStore,
  ops: WritableControlOps,
): void {
  writers.set(store, ops);
}

export function getWritableControlOps(
  store: ControlStore,
): WritableControlOps | null {
  return writers.get(store) ?? null;
}
