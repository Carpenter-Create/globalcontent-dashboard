import {
  assertControlPaths,
  cloneObjects,
  tipForObjects,
  type CasResult,
  type ControlObjects,
  type ControlSnapshot,
  type ControlTip,
  type MutableControlStore,
} from "./control-store";

/** In-memory mutable store for unit tests and dry-run without a ledger directory. */
export class MemoryControlStore implements MutableControlStore {
  private tip: ControlTip;
  private objects: Map<string, string>;

  constructor(initial?: ControlObjects) {
    this.objects = initial ? cloneObjects(initial) : new Map();
    this.tip = tipForObjects(this.objects);
  }

  async getTip(): Promise<ControlTip> {
    return this.tip;
  }

  async getSnapshot(): Promise<ControlSnapshot> {
    return { tip: this.tip, objects: cloneObjects(this.objects) };
  }

  async readObject(path: string): Promise<string | null> {
    return this.objects.get(path) ?? null;
  }

  async unsafeCompareAndSwap(
    expectedTip: ControlTip,
    nextObjects: Map<string, string>,
  ): Promise<CasResult> {
    if (this.tip !== expectedTip) {
      return {
        ok: false,
        code: "stale_tip",
        message: "expected tip does not match current tip",
        observedTip: this.tip,
      };
    }
    const pathErr = assertControlPaths(nextObjects);
    if (pathErr) {
      return {
        ok: false,
        code: "invalid_path",
        message: pathErr,
        observedTip: this.tip,
      };
    }
    this.objects = cloneObjects(nextObjects);
    this.tip = tipForObjects(this.objects);
    return {
      ok: true,
      tip: this.tip,
      objects: cloneObjects(this.objects),
    };
  }
}

export function emptyMemoryStore(): MemoryControlStore {
  return new MemoryControlStore();
}
