import { isControlMetadataPath } from "./control-github-allowlist";
import { parseControlPath } from "./control-paths";
import {
  LedgerIntegrityError,
  type ControlObjects,
  type ControlSnapshot,
} from "./control-store";
import type { AgenticGitHubConfig } from "./github-config";
import type { GitHubRestClient, GitTreeEntry } from "./github-rest";
import { readTaskEventChain } from "./control-ledger";
import { reconstructTaskState } from "./reconstruct-state";
import { createMemoryControlStore } from "./memory-control-store";

export type ControlBranchRead = {
  tip: string;
  treeSha: string;
  objects: ControlObjects;
  metadata: ReadonlyMap<string, string>;
  blobShas: ReadonlyMap<string, string>;
};

export type ControlReadResult =
  | { ok: true; value: ControlBranchRead }
  | { ok: false; code: string; message: string };

/**
 * Read ae/control tip + recursive tree into authority objects + allowlisted metadata.
 * Fail closed on truncated trees, unknown paths, or integrity failures.
 */
export async function readControlBranch(
  client: GitHubRestClient,
  config: AgenticGitHubConfig,
): Promise<ControlReadResult> {
  const tipRes = await client.getBranchTip(config.controlBranch);
  if (!tipRes.ok) {
    return {
      ok: false,
      code: tipRes.code,
      message: tipRes.message,
    };
  }
  const tip = tipRes.data;

  const commit = await client.getCommit(tip);
  if (!commit.ok) {
    return { ok: false, code: commit.code, message: commit.message };
  }

  const tree = await client.getTreeRecursive(commit.data.treeSha);
  if (!tree.ok) {
    return { ok: false, code: tree.code, message: tree.message };
  }

  return materializeControlTree(client, tip, commit.data.treeSha, tree.data.tree);
}

export async function readControlBranchAtTip(
  client: GitHubRestClient,
  tip: string,
): Promise<ControlReadResult> {
  const commit = await client.getCommit(tip);
  if (!commit.ok) {
    return { ok: false, code: commit.code, message: commit.message };
  }
  const tree = await client.getTreeRecursive(commit.data.treeSha);
  if (!tree.ok) {
    return { ok: false, code: tree.code, message: tree.message };
  }
  return materializeControlTree(client, tip, commit.data.treeSha, tree.data.tree);
}

async function materializeControlTree(
  client: GitHubRestClient,
  tip: string,
  treeSha: string,
  entries: GitTreeEntry[],
): Promise<ControlReadResult> {
  const objects = new Map<string, string>();
  const metadata = new Map<string, string>();
  const blobShas = new Map<string, string>();

  for (const entry of entries) {
    if (entry.type === "tree") continue;
    if (entry.type !== "blob") {
      return {
        ok: false,
        code: "unknown_object_type",
        message: `unsupported git object type ${entry.type} at ${entry.path}`,
      };
    }
    if (entry.mode !== "100644" && entry.mode !== "100755") {
      return {
        ok: false,
        code: "unsupported_mode",
        message: `unsupported blob mode ${entry.mode} at ${entry.path}`,
      };
    }

    const blob = await client.getBlobUtf8(entry.sha);
    if (!blob.ok) {
      return { ok: false, code: blob.code, message: blob.message };
    }

    if (isControlMetadataPath(entry.path)) {
      metadata.set(entry.path, blob.data);
      blobShas.set(entry.path, entry.sha);
      continue;
    }

    const parsed = parseControlPath(entry.path);
    if (!parsed.ok) {
      return {
        ok: false,
        code: "unknown_path",
        message: `unknown control path ${entry.path}: ${parsed.reason}`,
      };
    }
    objects.set(entry.path, blob.data);
    blobShas.set(entry.path, entry.sha);
  }

  const integrity = await verifyControlObjectIntegrity(objects);
  if (!integrity.ok) {
    return integrity;
  }

  return {
    ok: true,
    value: {
      tip,
      treeSha,
      objects,
      metadata,
      blobShas,
    },
  };
}

/**
 * Fail closed on malformed event chains / frozen-contract mismatches for every
 * task that has events in the object set.
 */
async function verifyControlObjectIntegrity(
  objects: ControlObjects,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const taskIds = new Set<string>();
  for (const path of objects.keys()) {
    const parsed = parseControlPath(path);
    if (parsed.ok) taskIds.add(parsed.taskId);
  }

  const store = createMemoryControlStore(objects);
  for (const taskId of taskIds) {
    const chain = readTaskEventChain(objects, taskId);
    if (!chain.ok && chain.issues[0]?.code !== "empty_chain") {
      return {
        ok: false,
        code: "broken_chain",
        message: chain.issues.map((i) => i.message).join("; "),
      };
    }
    if (chain.ok) {
      const recon = await reconstructTaskState(store, taskId);
      if (!recon.ok) {
        return {
          ok: false,
          code: recon.issues[0]?.code ?? "reconstruct_failed",
          message: recon.issues.map((i) => i.message).join("; "),
        };
      }
    }
  }
  return { ok: true };
}

export function controlReadToSnapshot(read: ControlBranchRead): ControlSnapshot {
  return { tip: read.tip, objects: read.objects };
}

export function assertControlReadOrThrow(result: ControlReadResult): ControlBranchRead {
  if (!result.ok) {
    throw new LedgerIntegrityError(result.message);
  }
  return result.value;
}
