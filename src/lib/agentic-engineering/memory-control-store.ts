import {
  type CasResult,
  type ControlObjects,
  type ControlSnapshot,
  type ControlStore,
  type ControlTip,
  assertControlPaths,
  EMPTY_CONTROL_TIP,
  tipForObjects,
} from "./control-store";

/**
 * In-memory ControlStore for tests and dry-run CAS simulations.
 * Only one logical writer succeeds per tip (global serialization model).
 */
export class MemoryControlStore implements ControlStore {
  private tip: ControlTip = EMPTY_CONTROL_TIP;
  private objects: Map<string, string> = new Map();

  constructor(initial?: ControlObjects) {
    if (initial) {
      const bad = assertControlPaths(initial);
      if (bad) throw new Error(`invalid initial control path: ${bad}`);
      this.objects = new Map(initial);
      this.tip = tipForObjects(this.objects);
    }
  }

  async getTip(): Promise<ControlTip> {
    return this.tip;
  }

  async getSnapshot(): Promise<ControlSnapshot> {
    return { tip: this.tip, objects: new Map(this.objects) };
  }

  async readObject(path: string): Promise<string | null> {
    return this.objects.has(path) ? this.objects.get(path)! : null;
  }

  async compareAndSwap(
    expectedTip: ControlTip,
    nextObjects: Map<string, string>,
  ): Promise<CasResult> {
    if (this.tip !== expectedTip) {
      return {
        ok: false,
        code: "stale_tip",
        message: `expected tip ${expectedTip}, observed ${this.tip}`,
        observedTip: this.tip,
      };
    }
    const bad = assertControlPaths(nextObjects);
    if (bad) {
      return {
        ok: false,
        code: "invalid_path",
        message: bad,
        observedTip: this.tip,
      };
    }
    this.objects = new Map(nextObjects);
    this.tip = tipForObjects(this.objects);
    return { ok: true, tip: this.tip, objects: new Map(this.objects) };
  }
}
