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
  tipForObjects,
  type CasResult,
  type ControlSnapshot,
  type ControlStore,
  type ControlTip,
} from "./control-store";
import { parseControlPath } from "./control-paths";
import { registerWritableControlStore } from "./internal/writable-registry";

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
  | { ok: true; store: ControlStore; root: string }
  | OpenFilesystemLedgerFailure;

/** @internal Test seam for publish fault injection — not part of package index. */
export type PublishFaultPoint =
  | "after_objects_to_prev"
  | "after_next_to_objects"
  | "before_tip_update"
  | "during_prev_cleanup";

let publishFaultPoint: PublishFaultPoint | null = null;

/** @internal */
export function __testOnly_setPublishFault(
  point: PublishFaultPoint | null,
): void {
  publishFaultPoint = point;
}

/**
 * Dedicated filesystem ledger adapter (constructible only via openFilesystemLedger).
 * Never recursively clears arbitrary user directories; only mutates a marked ledger root.
 */
class FilesystemControlStoreImpl implements ControlStore {
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
      return {
        ok: true,
        store: wrapFilesystemStore(new FilesystemControlStoreImpl(root)),
        root,
      };
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
      return {
        ok: true,
        store: wrapFilesystemStore(new FilesystemControlStoreImpl(root)),
        root,
      };
    }

    const markerOk = await readAndValidateMarker(markerPath);
    if (!markerOk.ok) return markerOk;

    const integrity = await loadAndValidateCanonicalState(root);
    if (!integrity.ok) {
      return {
        ok: false,
        code: "integrity_failure",
        message: integrity.message,
      };
    }

    return {
      ok: true,
      store: wrapFilesystemStore(new FilesystemControlStoreImpl(root)),
      root,
    };
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

  async compareAndSwapInternal(
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
      // Never delete objects.prev here — it may hold the last accepted state.
      await cleanupCandidateArtifacts(this.root);
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

function wrapFilesystemStore(impl: FilesystemControlStoreImpl): ControlStore {
  // Facade exposes only ControlStore methods — no runtime CAS escape hatch.
  const store: ControlStore = {
    getTip: () => impl.getTip(),
    getSnapshot: () => impl.getSnapshot(),
    readObject: (objectPath) => impl.readObject(objectPath),
  };
  registerWritableControlStore(store, {
    unsafeCompareAndSwap: (expectedTip, nextObjects) =>
      impl.compareAndSwapInternal(expectedTip, nextObjects),
  });
  return store;
}

class LockBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockBusyError";
  }
}

class PublishFaultError extends Error {
  constructor(point: PublishFaultPoint) {
    super(`injected publish fault: ${point}`);
    this.name = "PublishFaultError";
  }
}

/**
 * Lexically resolve the path, then lstat every existing ancestor component.
 * Reject ANY symlink in the ancestor chain or at the ledger root.
 * Do not rely on realpath() to silently follow symlinks.
 */
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
  const fsRoot = path.parse(absolute).root;

  if (absolute === fsRoot || absolute === "/") {
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

  const base = path.basename(absolute);
  if (!base || base === "." || base === "..") {
    return {
      ok: false,
      code: "rejected_root",
      message: "ledger path basename is invalid",
    };
  }

  const rel = path.relative(fsRoot, absolute);
  const parts = rel.split(path.sep).filter((p) => p.length > 0);
  let current = fsRoot;

  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]);
    let st: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      st = await fs.lstat(current);
    } catch (err) {
      if (!isEnoent(err)) throw err;
      // Remaining components (including ledger leaf) do not exist yet.
      if (i < parts.length - 1) {
        return {
          ok: false,
          code: "not_found",
          message: `ancestor directory does not exist: ${current}`,
        };
      }
      // Leaf missing — parent chain fully validated as real directories.
      const parent = path.dirname(absolute);
      // Confinement: parent has no symlink ancestors; lexical parent is the root parent.
      const root = absolute;
      if (root === cwd || root === home || root === fsRoot) {
        return {
          ok: false,
          code: "rejected_root",
          message: "resolved ledger path is not a dedicated ledger directory",
        };
      }
      // Confirm parent still exists as a directory (not a race to symlink).
      const parentCheck = await assertRealDirectory(parent);
      if (!parentCheck.ok) return parentCheck;
      return { ok: true, root, existed: false };
    }

    if (st.isSymbolicLink()) {
      return {
        ok: false,
        code: "symlink_rejected",
        message: `path contains symlink component: ${current}`,
      };
    }

    const isLeaf = i === parts.length - 1;
    if (!isLeaf && !st.isDirectory()) {
      return {
        ok: false,
        code: "not_a_directory",
        message: `ancestor path is not a directory: ${current}`,
      };
    }
    if (isLeaf) {
      if (!st.isDirectory()) {
        return {
          ok: false,
          code: "not_a_directory",
          message: "ledger path exists and is not a directory",
        };
      }
      // After full ancestor+leaf validation with lstat (no symlink follow),
      // confirm realpath equals lexical path (defense in depth).
      const real = await fs.realpath(current);
      if (real !== current) {
        return {
          ok: false,
          code: "symlink_rejected",
          message: "ledger root resolves through a symlink",
        };
      }
      if (current === cwd || current === home || current === fsRoot) {
        return {
          ok: false,
          code: "rejected_root",
          message: "resolved ledger path is not a dedicated ledger directory",
        };
      }
      return { ok: true, root: current, existed: true };
    }
  }

  return {
    ok: false,
    code: "rejected_root",
    message: "unable to resolve ledger path",
  };
}

async function assertRealDirectory(
  dir: string,
): Promise<{ ok: true } | OpenFilesystemLedgerFailure> {
  let st: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    st = await fs.lstat(dir);
  } catch (err) {
    if (!isEnoent(err)) throw err;
    return {
      ok: false,
      code: "not_found",
      message: `parent directory does not exist: ${dir}`,
    };
  }
  if (st.isSymbolicLink()) {
    return {
      ok: false,
      code: "symlink_rejected",
      message: `path contains symlink component: ${dir}`,
    };
  }
  if (!st.isDirectory()) {
    return {
      ok: false,
      code: "not_a_directory",
      message: "ledger parent path is not a directory",
    };
  }
  return { ok: true };
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch (err) {
    if (isEnoent(err)) return false;
    throw err;
  }
}

async function loadAndValidateCanonicalState(root: string): Promise<LoadedState> {
  // Incomplete publish artifacts fail closed — never auto-normalize.
  if (await pathExists(path.join(root, LEDGER_OBJECTS_NEXT_DIR))) {
    return {
      ok: false,
      message: `incomplete publish artifact present: ${LEDGER_OBJECTS_NEXT_DIR}`,
    };
  }
  if (await pathExists(path.join(root, LEDGER_TIP_NEXT_NAME))) {
    return {
      ok: false,
      message: `incomplete publish artifact present: ${LEDGER_TIP_NEXT_NAME}`,
    };
  }
  if (await pathExists(path.join(root, LEDGER_OBJECTS_PREV_DIR))) {
    return {
      ok: false,
      message: `incomplete publish artifact present: ${LEDGER_OBJECTS_PREV_DIR} (last accepted backup retained; refuse to normalize)`,
    };
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

/**
 * Publish phases (under exclusive lock):
 * 1. Build + validate candidate objects.next (+ tip.next)
 * 2. Rename objects → objects.prev  (backup of last accepted)
 * 3. Rename objects.next → objects
 * 4. Update .control-tip from tip.next
 * 5. Only then remove objects.prev
 *
 * objects.prev is NEVER deleted by candidate cleanup. If publish fails after
 * creating prev, artifacts remain and subsequent reads fail closed.
 */
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

  // Refuse to start if a prior incomplete backup remains.
  if (await pathExists(prevDir)) {
    throw new Error(
      `${LEDGER_OBJECTS_PREV_DIR} already present; refuse to publish over incomplete prior state`,
    );
  }

  // Candidates from a failed pre-swap build are safe to clear.
  await cleanupCandidateArtifacts(root);

  await fs.mkdir(nextDir, { recursive: false });
  for (const [objectPath, content] of nextObjects) {
    const abs = path.join(nextDir, objectPath);
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

  // Phase: rename current accepted → backup
  await fs.rename(objectsDir, prevDir);
  if (publishFaultPoint === "after_objects_to_prev") {
    throw new PublishFaultError("after_objects_to_prev");
  }

  // Phase: promote candidate → canonical objects
  await fs.rename(nextDir, objectsDir);
  if (publishFaultPoint === "after_next_to_objects") {
    throw new PublishFaultError("after_next_to_objects");
  }

  if (publishFaultPoint === "before_tip_update") {
    throw new PublishFaultError("before_tip_update");
  }

  // Phase: tip update (canonical objects already new)
  await fs.rename(tipNextPath, tipPath);

  // Phase: remove backup only after new canonical objects + tip accepted
  try {
    if (publishFaultPoint === "during_prev_cleanup") {
      throw new PublishFaultError("during_prev_cleanup");
    }
    await fs.rm(prevDir, { recursive: true, force: false });
  } catch (err) {
    // Tip + objects are already the new accepted state. Leaving prev is a
    // detectable incomplete-cleanup condition (fail closed on next open).
    throw new Error(
      `canonical publish succeeded but backup cleanup failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/** Remove disposable candidate artifacts only — never objects.prev. */
async function cleanupCandidateArtifacts(root: string): Promise<void> {
  for (const name of [LEDGER_OBJECTS_NEXT_DIR, LEDGER_TIP_NEXT_NAME]) {
    await fs.rm(path.join(root, name), { recursive: true, force: true });
  }
}

async function acquireExclusiveLock(
  root: string,
): Promise<() => Promise<void>> {
  const lockPath = path.join(root, LEDGER_LOCK_NAME);
  const token = `${process.pid}:${randomUUID()}\n`;
  const deadline = Date.now() + 2_000;

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

export async function openFilesystemLedger(
  userPath: string,
  options: OpenFilesystemLedgerOptions = {},
): Promise<OpenFilesystemLedgerResult> {
  return FilesystemControlStoreImpl.open(userPath, options);
}
