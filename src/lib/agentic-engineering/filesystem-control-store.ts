import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  type CasResult,
  type ControlSnapshot,
  type ControlStore,
  type ControlTip,
  assertControlPaths,
  EMPTY_CONTROL_TIP,
  tipForObjects,
} from "./control-store";
import { parseControlPath } from "./control-paths";

/**
 * Filesystem-backed ControlStore under a local root directory.
 * Layout mirrors conceptual ae/control paths. Tip stored in `.control-tip`.
 *
 * Not a Git repository — dry-run / test adapter only.
 */
export class FilesystemControlStore implements ControlStore {
  constructor(private readonly root: string) {}

  private tipPath(): string {
    return path.join(this.root, ".control-tip");
  }

  private objectPath(controlPath: string): string {
    return path.join(this.root, ...controlPath.split("/"));
  }

  async initEmpty(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    try {
      await readFile(this.tipPath(), "utf8");
    } catch {
      await writeFile(this.tipPath(), EMPTY_CONTROL_TIP, "utf8");
    }
  }

  async getTip(): Promise<ControlTip> {
    try {
      return (await readFile(this.tipPath(), "utf8")).trim();
    } catch {
      return EMPTY_CONTROL_TIP;
    }
  }

  async getSnapshot(): Promise<ControlSnapshot> {
    const objects = await this.loadAll();
    const tip = tipForObjects(objects);
    // Keep tip file in sync if missing/corrupt
    const stored = await this.getTip();
    if (stored !== tip) {
      await writeFile(this.tipPath(), tip, "utf8");
    }
    return { tip, objects };
  }

  async readObject(controlPath: string): Promise<string | null> {
    try {
      return await readFile(this.objectPath(controlPath), "utf8");
    } catch {
      return null;
    }
  }

  async compareAndSwap(
    expectedTip: ControlTip,
    nextObjects: Map<string, string>,
  ): Promise<CasResult> {
    const snapshot = await this.getSnapshot();
    if (snapshot.tip !== expectedTip) {
      return {
        ok: false,
        code: "stale_tip",
        message: `expected tip ${expectedTip}, observed ${snapshot.tip}`,
        observedTip: snapshot.tip,
      };
    }
    const bad = assertControlPaths(nextObjects);
    if (bad) {
      return {
        ok: false,
        code: "invalid_path",
        message: bad,
        observedTip: snapshot.tip,
      };
    }

    // Rewrite object tree under root (excluding tip file)
    await this.clearObjects();
    for (const [controlPath, content] of nextObjects) {
      const abs = this.objectPath(controlPath);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
    }
    const tip = tipForObjects(nextObjects);
    await writeFile(this.tipPath(), tip, "utf8");
    return { ok: true, tip, objects: new Map(nextObjects) };
  }

  private async clearObjects(): Promise<void> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(
      () => [],
    );
    for (const ent of entries) {
      if (ent.name === ".control-tip") continue;
      await rm(path.join(this.root, ent.name), { recursive: true, force: true });
    }
  }

  private async loadAll(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    await this.walk(this.root, "", out);
    return out;
  }

  private async walk(
    absDir: string,
    relPrefix: string,
    out: Map<string, string>,
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name === ".control-tip") continue;
      const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
      const abs = path.join(absDir, ent.name);
      if (ent.isDirectory()) {
        await this.walk(abs, rel, out);
      } else if (ent.isFile()) {
        const parsed = parseControlPath(rel);
        if (!parsed.ok) continue;
        out.set(rel, await readFile(abs, "utf8"));
      }
    }
  }
}
