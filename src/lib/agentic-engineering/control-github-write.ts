import { isControlMetadataPath } from "./control-github-allowlist";
import {
  readControlBranchAtTip,
  type ControlBranchRead,
} from "./control-github-read";
import { parseControlPath } from "./control-paths";
import {
  contentDigestMap,
  type CasResult,
  type ControlObjects,
} from "./control-store";
import type { AgenticGitHubConfig } from "./github-config";
import type { GitHubRestClient } from "./github-rest";
import { verifyProtectedObjectDelta } from "./protected-delta";

export type ControlCasWriteInput = {
  client: GitHubRestClient;
  config: AgenticGitHubConfig;
  expectedTip: string;
  nextObjects: ControlObjects;
  commitMessage: string;
  /** Optional metadata overlays; defaults to preserving existing metadata. */
  nextMetadata?: ReadonlyMap<string, string>;
};

/**
 * Constrained CAS write to ae/control only.
 * Preserves prior protected blobs exactly; adds/replaces only allowed paths;
 * non-force ref update; no automatic retry on stale tip.
 */
export async function compareAndSwapControlBranch(
  input: ControlCasWriteInput,
): Promise<CasResult> {
  const { client, config, expectedTip, nextObjects, commitMessage } = input;

  if (!config.controlBranch || config.controlBranch.includes("..")) {
    return {
      ok: false,
      code: "internal_error",
      message: "control branch must be a safe configured name",
    };
  }
  // Phase C writes only the configured control branch (default ae/control).
  // Application branches (e.g. main) are never accepted as controlBranch in config
  // loaders used by the supervised CLI.
  const tipRes = await client.getBranchTip(config.controlBranch);
  if (!tipRes.ok) {
    return {
      ok: false,
      code: tipRes.code === "not_found" ? "internal_error" : "internal_error",
      message: tipRes.message,
    };
  }
  if (tipRes.data !== expectedTip) {
    return {
      ok: false,
      code: "stale_tip",
      message: `expected tip ${expectedTip}, observed ${tipRes.data}`,
      observedTip: tipRes.data,
    };
  }

  const prior = await readControlBranchAtTip(client, expectedTip);
  if (!prior.ok) {
    return {
      ok: false,
      code: "integrity_failure",
      message: prior.message,
      observedTip: expectedTip,
    };
  }

  for (const path of nextObjects.keys()) {
    const parsed = parseControlPath(path);
    if (!parsed.ok) {
      return {
        ok: false,
        code: "invalid_path",
        message: `${path}: ${parsed.reason}`,
        observedTip: expectedTip,
      };
    }
  }

  const delta = verifyProtectedObjectDelta(
    contentDigestMap(prior.value.objects),
    contentDigestMap(nextObjects),
  );
  if (!delta.ok) {
    return {
      ok: false,
      code: "integrity_failure",
      message: delta.issues.map((i) => i.message).join("; "),
      observedTip: expectedTip,
    };
  }

  const metadata = input.nextMetadata
    ? new Map(input.nextMetadata)
    : new Map(prior.value.metadata);

  for (const path of metadata.keys()) {
    if (!isControlMetadataPath(path)) {
      return {
        ok: false,
        code: "invalid_path",
        message: `metadata path not allowlisted: ${path}`,
        observedTip: expectedTip,
      };
    }
  }

  const treeEntries: Array<{
    path: string;
    mode: "100644";
    type: "blob";
    sha: string;
  }> = [];

  // Preserve or recreate metadata blobs.
  for (const [path, content] of metadata) {
    const sha = await blobShaFor(
      client,
      prior.value,
      path,
      content,
    );
    if (!sha.ok) {
      return {
        ok: false,
        code: "internal_error",
        message: sha.message,
        observedTip: expectedTip,
      };
    }
    treeEntries.push({ path, mode: "100644", type: "blob", sha: sha.sha });
  }

  // Authority + derived objects — reuse blob SHAs when bytes unchanged.
  for (const [path, content] of [...nextObjects.entries()].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    const sha = await blobShaFor(client, prior.value, path, content);
    if (!sha.ok) {
      return {
        ok: false,
        code: "internal_error",
        message: sha.message,
        observedTip: expectedTip,
      };
    }
    treeEntries.push({ path, mode: "100644", type: "blob", sha: sha.sha });
  }

  // Full tree replacement (no base_tree) so omission cannot silently drop paths.
  const tree = await client.createTree(treeEntries);
  if (!tree.ok) {
    return {
      ok: false,
      code: "internal_error",
      message: tree.message,
      observedTip: expectedTip,
    };
  }

  const commit = await client.createCommit({
    message: commitMessage,
    treeSha: tree.data,
    parentShas: [expectedTip],
  });
  if (!commit.ok) {
    return {
      ok: false,
      code: "internal_error",
      message: commit.message,
      observedTip: expectedTip,
    };
  }

  const updated = await client.updateRef(
    config.controlBranch,
    commit.data,
    expectedTip,
  );
  if (!updated.ok) {
    if (updated.message.startsWith("stale_tip")) {
      const observed = updated.message.match(/observed ([0-9a-f]{40})/)?.[1];
      return {
        ok: false,
        code: "stale_tip",
        message: updated.message,
        observedTip: observed,
      };
    }
    return {
      ok: false,
      code: "stale_tip",
      message: updated.message,
      observedTip: expectedTip,
    };
  }

  return {
    ok: true,
    tip: commit.data,
    objects: nextObjects,
  };
}

async function blobShaFor(
  client: GitHubRestClient,
  prior: ControlBranchRead,
  path: string,
  content: string,
): Promise<{ ok: true; sha: string } | { ok: false; message: string }> {
  const priorContent =
    prior.objects.get(path) ?? prior.metadata.get(path) ?? null;
  if (priorContent === content && prior.blobShas.has(path)) {
    return { ok: true, sha: prior.blobShas.get(path)! };
  }
  const created = await client.createBlob(content);
  if (!created.ok) {
    return { ok: false, message: created.message };
  }
  return { ok: true, sha: created.data };
}
