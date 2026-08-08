import { randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  promises as fs,
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  EMPTY_CONTROL_TIP,
  LedgerIntegrityError,
  assertControlPaths,
  cloneObjects,
  tipForObjects,
  type CasResult,
  type ControlSnapshot,
  type ControlTip,
  type MutableControlStore,
} from "./control-store";
import { parseControlPath } from "./control-paths";

export const LEDGER_MARKER_NAME = ".ae-control-ledger";
export const LEDGER_TIP_NAME = ".control-tip";
export const LEDGER_LOCK_NAME = ".control-lock";
export const LEDGER_OBJECTS_DIR = "objects";
export const LEDGER_OBJECTS_NEXT_DIR = "objects.next";
export const LEDGER_OBJECTS_PREV_DIR = "objects.prev";
export const LEDGER_TIP_NEXT_NAME = ".control-tip.next";

export const LEDGER_MARKER_CONTENTS = "ae-control-ledger/v1\n";

const ALLOWED_INIT_ENTRIES = new Set([
  LEDGER_MARKER_NAME,
  LEDGER_TIP_NAME,
  LEDGER_LOCK_NAME,
  LEDGER_OBJECTS_DIR,
  ".DS_Store",
]);

export type OpenFilesystemLedgerOptions = {
  /** Create a new dedicated ledger when the target does not exist (or is empty and unmarked). */
  create?: boolean;
};

export type OpenFilesystemLedgerFailure = {
  ok: false;
  code:
    | "rejected_root"
    | "symlink_rejected"
    | "not_empty"
    | "not_a_directory"
    | "missing_marker"
    | "malformed_marker"
    | "integrity_failure"
    | "not_found";
  message: string;
};

export type OpenFilesystemLedgerResult =
  | { ok: true; store: FilesystemControlStore; root: string }
  | OpenFilesystemLedgerFailure;

/**
 * Dedicated filesystem ledger adapter.
 * Never recursively clears arbitrary user directories; only mutates a marked ledger root.
 */
export class FilesystemControlStore implements MutableControlStore {
  private constructor(readonly root: string) {}

  static async open(
    userPath: string,
    options: OpenFilesystemLedgerOptions = {},
  ): Promise<OpenFilesystemLedgerResult> {
    const resolved = await resolveDedicatedLedgerRoot(userPath);
    if (!resolved.ok) return resolved;

    const { root, existed } = resolved;

    if (!existed) {
      if (!options.create) {
        return {
          ok: false,
          code: "not_found",
          message: `ledger directory does not exist: ${root}`,
        };
      }
      await fs.mkdir(root, { recursive: false });
      await initializeEmptyLedger(root);
      return { ok: true, store: new FilesystemControlStore(root), root };
    }

    const markerPath = path.join(root, LEDGER_MARKER_NAME);
    let markerPresent = false;
    try {
      await fs.lstat(markerPath);
      markerPresent = true;
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }

    if (!markerPresent) {
      const emptiness = await assertEmptyOrAllowedInit(root);
      if (!emptiness.ok) return emptiness;
      if (!options.create) {
        return {
          ok: false,
          code: "missing_marker",
          message: `directory is not a marked control ledger: ${root}`,
        };
      }
      await initializeEmptyLedger(root);
      return { ok: true, store: new FilesystemControlStore(root), root };
    }

    const markerOk = await readAndValidateMarker(markerPath);
    if (!markerOk.ok) return markerOk;

    // Initialized marked ledger — fail closed on integrity issues.
    const integrity = await loadAndValidateCanonicalState(root);
    if (!integrity.ok) {
      return {
        ok: false,
        code: "integrity_failure",
        message: integrity.message,
      };
    }

    return { ok: true, store: new FilesystemControlStore(root), root };
  }

  async getTip(): Promise<ControlTip> {
    const snap = await this.getSnapshot();
    return snap.tip;
  }

  async getSnapshot(): Promise<ControlSnapshot> {
    const loaded = await loadAndValidateCanonicalState(this.root);
    if (!loaded.ok) {
      throw new LedgerIntegrityError(loaded.message);
    }
    return { tip: loaded.tip, objects: loaded.objects };
  }

  async readObject(objectPath: string): Promise<string | null> {
    const snap = await this.getSnapshot();
    return snap.objects.get(objectPath) ?? null;
  }

  async unsafeCompareAndSwap(
    expectedTip: ControlTip,
    nextObjects: Map<string, string>,
  ): Promise<CasResult> {
    const pathErr = assertControlPaths(nextObjects);
    if (pathErr) {
      return { ok: false, code: "invalid_path", message: pathErr };
    }

    let release: (() => Promise<void>) | null = null;
    try {
      release = await acquireExclusiveLock(this.root);
    } catch (err) {
      if (err instanceof LockBusyError) {
        return {
          ok: false,
          code: "lock_busy",
          message: err.message,
        };
      }
      throw err;
    }

    try {
      const current = await loadAndValidateCanonicalState(this.root);
      if (!current.ok) {
        return {
          ok: false,
          code: "integrity_failure",
          message: current.message,
        };
      }
      if (current.tip !== expectedTip) {
        return {
          ok: false,
          code: "stale_tip",
          message: "expected tip does not match current tip",
          observedTip: current.tip,
        };
      }

      const nextTip = tipForObjects(nextObjects);
      await publishObjectsAtomically(this.root, nextObjects, nextTip);

      // Re-validate published state before accepting.
      const published = await loadAndValidateCanonicalState(this.root);
      if (!published.ok) {
        return {
          ok: false,
          code: "integrity_failure",
          message: `post-publish integrity failure: ${published.message}`,
        };
      }
      if (published.tip !== nextTip) {
        return {
          ok: false,
          code: "integrity_failure",
          message: "post-publish tip mismatch",
          observedTip: published.tip,
        };
      }

      return {
        ok: true,
        tip: published.tip,
        objects: published.objects,
      };
    } catch (err) {
      await cleanupFailedPublish(this.root);
      return {
        ok: false,
        code: "internal_error",
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (release) await release();
    }
  }
}

class LockBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockBusyError";
  }
}

async function resolveDedicatedLedgerRoot(
  userPath: string,
): Promise<
  | { ok: true; root: string; existed: boolean }
  | OpenFilesystemLedgerFailure
> {
  if (typeof userPath !== "string" || userPath.trim() === "") {
    return {
      ok: false,
      code: "rejected_root",
      message: "ledger path is required",
    };
  }

  const absolute = path.resolve(userPath);
  const cwd = path.resolve(process.cwd());
  const home = path.resolve(os.homedir());

  // Reject before any mutation.
  if (absolute === path.parse(absolute).root || absolute === "/") {
    return {
      ok: false,
      code: "rejected_root",
      message: "ledger must not be filesystem root",
    };
  }
  if (absolute === cwd) {
    return {
      ok: false,
      code: "rejected_root",
      message: "ledger must not be the repository / current working directory",
    };
  }
  if (absolute === home) {
    return {
      ok: false,
      code: "rejected_root",
      message: "ledger must not be the home directory",
    };
  }

  const parent = path.dirname(absolute);
  const base = path.basename(absolute);
  if (!base || base === "." || base === "..") {
    return {
      ok: false,
      code: "rejected_root",
      message: "ledger path basename is invalid",
    };
  }

  // Reject when the immediate parent is a symlink (path escape via
  // user-controlled symlink components). Ancestors like macOS /var →
  // /private/var are resolved via realpath and are not user-controlled
  // ledger components.
  let parentStat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    parentStat = await fs.lstat(parent);
  } catch (err) {
    if (!isEnoent(err)) throw err;
    return {
      ok: false,
      code: "not_found",
      message: `parent directory does not exist: ${parent}`,
    };
  }
  if (parentStat.isSymbolicLink()) {
    return {
      ok: false,
      code: "symlink_rejected",
      message: `path contains symlink component: ${parent}`,
    };
  }
  if (!parentStat.isDirectory()) {
    return {
      ok: false,
      code: "not_a_directory",
      message: "ledger parent path is not a directory",
    };
  }

  const parentReal = await fs.realpath(parent);
  const root = path.join(parentReal, base);

  if (root === cwd || root === home || root === "/" || root === path.parse(root).root) {
    return {
      ok: false,
      code: "rejected_root",
      message: "resolved ledger path is not a dedicated ledger directory",
    };
  }

  let existed = true;
  let leafStat: Awaited<ReturnType<typeof fs.lstat>> | null = null;
  try {
    leafStat = await fs.lstat(root);
  } catch (err) {
    if (!isEnoent(err)) throw err;
    existed = false;
  }

  if (leafStat) {
    if (leafStat.isSymbolicLink()) {
      return {
        ok: false,
        code: "symlink_rejected",
        message: "ledger root must not be a symlink",
      };
    }
    if (!leafStat.isDirectory()) {
      return {
        ok: false,
        code: "not_a_directory",
        message: "ledger path exists and is not a directory",
      };
    }
    const realRoot = await fs.realpath(root);
    if (realRoot !== root) {
      return {
        ok: false,
        code: "symlink_rejected",
        message: "ledger root resolves through a symlink",
      };
    }
  }

  return { ok: true, root, existed };
}

async function assertEmptyOrAllowedInit(
  root: string,
): Promise<{ ok: true } | OpenFilesystemLedgerFailure> {
  const entries = await fs.readdir(root);
  for (const name of entries) {
    if (!ALLOWED_INIT_ENTRIES.has(name)) {
      return {
        ok: false,
        code: "not_empty",
        message: `directory is not empty (contains ${name}); refusing to use as ledger`,
      };
    }
  }
  return { ok: true };
}

async function initializeEmptyLedger(root: string): Promise<void> {
  await fs.writeFile(
    path.join(root, LEDGER_MARKER_NAME),
    LEDGER_MARKER_CONTENTS,
    { encoding: "utf8", flag: "wx" },
  );
  await fs.mkdir(path.join(root, LEDGER_OBJECTS_DIR), { recursive: false });
  await fs.writeFile(
    path.join(root, LEDGER_TIP_NAME),
    `${EMPTY_CONTROL_TIP}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}

async function readAndValidateMarker(
  markerPath: string,
): Promise<{ ok: true } | OpenFilesystemLedgerFailure> {
  let st;
  try {
    st = await fs.lstat(markerPath);
  } catch (err) {
    if (isEnoent(err)) {
      return {
        ok: false,
        code: "missing_marker",
        message: "ledger marker missing",
      };
    }
    throw err;
  }
  if (st.isSymbolicLink() || !st.isFile()) {
    return {
      ok: false,
      code: "malformed_marker",
      message: "ledger marker must be a regular file",
    };
  }
  const text = await fs.readFile(markerPath, "utf8");
  if (text !== LEDGER_MARKER_CONTENTS) {
    return {
      ok: false,
      code: "malformed_marker",
      message: "ledger marker contents are malformed",
    };
  }
  return { ok: true };
}

type LoadedState =
  | { ok: true; tip: ControlTip; objects: Map<string, string> }
  | { ok: false; message: string };

async function loadAndValidateCanonicalState(root: string): Promise<LoadedState> {
  // Residual publish artifacts indicate crash / partial failure.
  for (const name of [
    LEDGER_OBJECTS_NEXT_DIR,
    LEDGER_OBJECTS_PREV_DIR,
    LEDGER_TIP_NEXT_NAME,
  ]) {
    try {
      await fs.lstat(path.join(root, name));
      return {
        ok: false,
        message: `incomplete publish artifact present: ${name}`,
      };
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
  }

  const markerOk = await readAndValidateMarker(
    path.join(root, LEDGER_MARKER_NAME),
  );
  if (!markerOk.ok) {
    return { ok: false, message: markerOk.message };
  }

  const tipPath = path.join(root, LEDGER_TIP_NAME);
  let tipStat;
  try {
    tipStat = await fs.lstat(tipPath);
  } catch (err) {
    if (isEnoent(err)) {
      return {
        ok: false,
        message: "missing .control-tip on initialized marked ledger",
      };
    }
    throw err;
  }
  if (tipStat.isSymbolicLink() || !tipStat.isFile()) {
    return { ok: false, message: ".control-tip must be a regular file" };
  }

  let tipRaw: string;
  try {
    tipRaw = await fs.readFile(tipPath, "utf8");
  } catch {
    return { ok: false, message: "unreadable .control-tip" };
  }
  const tip = tipRaw.replace(/\n$/, "");
  if (!tip.startsWith("tip:") || tip.includes("\n")) {
    return { ok: false, message: "malformed .control-tip" };
  }

  const objectsDir = path.join(root, LEDGER_OBJECTS_DIR);
  let objectsDirStat;
  try {
    objectsDirStat = await fs.lstat(objectsDir);
  } catch (err) {
    if (isEnoent(err)) {
      return { ok: false, message: "missing objects/ directory" };
    }
    throw err;
  }
  if (objectsDirStat.isSymbolicLink() || !objectsDirStat.isDirectory()) {
    return { ok: false, message: "objects/ must be a directory" };
  }

  // Reject unknown top-level entries (fail closed).
  const topEntries = await fs.readdir(root);
  const allowedTop = new Set([
    LEDGER_MARKER_NAME,
    LEDGER_TIP_NAME,
    LEDGER_LOCK_NAME,
    LEDGER_OBJECTS_DIR,
    ".DS_Store",
  ]);
  for (const name of topEntries) {
    if (!allowedTop.has(name)) {
      return {
        ok: false,
        message: `unknown path at ledger root: ${name}`,
      };
    }
    const st = await fs.lstat(path.join(root, name));
    if (st.isSymbolicLink()) {
      return { ok: false, message: `symlink at ledger root: ${name}` };
    }
  }

  const objects = new Map<string, string>();
  try {
    await walkObjects(objectsDir, "", objects);
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const recomputed = tipForObjects(objects);
  if (recomputed !== tip) {
    return {
      ok: false,
      message: `tip mismatch vs recomputed state (stored=${tip}, recomputed=${recomputed})`,
    };
  }

  return { ok: true, tip, objects };
}

async function walkObjects(
  absDir: string,
  relPrefix: string,
  out: Map<string, string>,
): Promise<void> {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const abs = path.join(absDir, entry.name);

    // Dirent from readdir may follow; use lstat for symlink detection.
    const st = await fs.lstat(abs);
    if (st.isSymbolicLink()) {
      throw new LedgerIntegrityError(`symlink in objects/: ${rel}`);
    }
    if (st.isDirectory()) {
      await walkObjects(abs, rel, out);
      continue;
    }
    if (!st.isFile()) {
      throw new LedgerIntegrityError(
        `unsupported filesystem entry type in objects/: ${rel}`,
      );
    }

    const parsed = parseControlPath(rel);
    if (!parsed.ok) {
      throw new LedgerIntegrityError(`unknown/invalid control path: ${rel}`);
    }

    let content: string;
    try {
      content = await fs.readFile(abs, "utf8");
    } catch {
      throw new LedgerIntegrityError(`unreadable protected object: ${rel}`);
    }
    out.set(rel, content);
  }
}

async function publishObjectsAtomically(
  root: string,
  nextObjects: Map<string, string>,
  nextTip: ControlTip,
): Promise<void> {
  const nextDir = path.join(root, LEDGER_OBJECTS_NEXT_DIR);
  const prevDir = path.join(root, LEDGER_OBJECTS_PREV_DIR);
  const objectsDir = path.join(root, LEDGER_OBJECTS_DIR);
  const tipNextPath = path.join(root, LEDGER_TIP_NEXT_NAME);
  const tipPath = path.join(root, LEDGER_TIP_NAME);

  await cleanupFailedPublish(root);

  await fs.mkdir(nextDir, { recursive: false });
  for (const [objectPath, content] of nextObjects) {
    const abs = path.join(nextDir, objectPath);
    // Confinement: resolved path must stay under nextDir.
    const resolvedFile = path.resolve(abs);
    if (
      resolvedFile !== nextDir &&
      !resolvedFile.startsWith(nextDir + path.sep)
    ) {
      throw new Error(`path escapes ledger objects root: ${objectPath}`);
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, { encoding: "utf8", flag: "wx" });
  }

  await fs.writeFile(tipNextPath, `${nextTip}\n`, {
    encoding: "utf8",
    flag: "wx",
  });

  // Swap objects directory, then tip. Crash between them → tip mismatch → fail closed.
  await fs.rename(objectsDir, prevDir);
  await fs.rename(nextDir, objectsDir);
  await fs.rename(tipNextPath, tipPath);
  await fs.rm(prevDir, { recursive: true, force: true });
}

async function cleanupFailedPublish(root: string): Promise<void> {
  for (const name of [
    LEDGER_OBJECTS_NEXT_DIR,
    LEDGER_OBJECTS_PREV_DIR,
    LEDGER_TIP_NEXT_NAME,
  ]) {
    await fs.rm(path.join(root, name), { recursive: true, force: true });
  }
}

async function acquireExclusiveLock(
  root: string,
): Promise<() => Promise<void>> {
  const lockPath = path.join(root, LEDGER_LOCK_NAME);
  const token = `${process.pid}:${randomUUID()}\n`;
  const deadline = Date.now() + 2_000;

  // Brief local retry so a waiting writer can re-check tip after the holder
  // publishes, rather than failing only on lock_busy.
  while (true) {
    try {
      const handle = await fs.open(
        lockPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      );
      await handle.writeFile(token, "utf8");
      await handle.close();
      break;
    } catch (err) {
      if (isEexist(err) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5));
        continue;
      }
      if (isEexist(err)) {
        throw new LockBusyError("ledger lock busy");
      }
      throw err;
    }
  }

  return async () => {
    try {
      await fs.unlink(lockPath);
    } catch (err) {
      if (!isEnoent(err)) throw err;
    }
  };
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}

function isEexist(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "EEXIST"
  );
}

/** @deprecated Use FilesystemControlStore.open / openFilesystemLedger. */
export async function openFilesystemControlStore(
  rootDir: string,
): Promise<FilesystemControlStore> {
  const opened = await FilesystemControlStore.open(rootDir, { create: true });
  if (!opened.ok) {
    throw new Error(`${opened.code}: ${opened.message}`);
  }
  return opened.store;
}

export async function openFilesystemLedger(
  userPath: string,
  options: OpenFilesystemLedgerOptions = {},
): Promise<OpenFilesystemLedgerResult> {
  return FilesystemControlStore.open(userPath, options);
}

export { cloneObjects, tipForObjects };
