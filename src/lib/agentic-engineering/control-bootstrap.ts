import {
  BOOTSTRAP_CONTROL_PLANE_MD,
  BOOTSTRAP_MARKER,
} from "./control-github-allowlist";
import type { AgenticGitHubConfig } from "./github-config";
import { repoFullName } from "./github-config";
import type { GitHubRestClient } from "./github-rest";

export type BootstrapPreview = {
  repository: string;
  controlBranch: string;
  strategy: "orphan-commit";
  files: Array<{ path: string; bytes: number }>;
  mainTip: string | null;
};

export type BootstrapResult =
  | {
      ok: true;
      dryRun: boolean;
      preview: BootstrapPreview;
      tip?: string;
    }
  | { ok: false; code: string; message: string };

/**
 * Supervised ae/control bootstrap.
 * Creates an orphan commit (parents: []) with allowlisted metadata only.
 * Defaults to dry-run; pass apply=true for the createRef mutation.
 */
export async function bootstrapControlBranch(input: {
  client: GitHubRestClient;
  config: AgenticGitHubConfig;
  apply: boolean;
}): Promise<BootstrapResult> {
  const { client, config, apply } = input;

  const repo = await client.getRepository();
  if (!repo.ok) {
    return { ok: false, code: repo.code, message: repo.message };
  }
  const expected = repoFullName(config);
  if (repo.data.full_name !== expected) {
    return {
      ok: false,
      code: "wrong_repository",
      message: `expected ${expected}, got ${repo.data.full_name}`,
    };
  }

  const mainTip = await client.getBranchTip(repo.data.default_branch);
  const mainTipSha = mainTip.ok ? mainTip.data : null;

  const existing = await client.getBranchTip(config.controlBranch);
  if (existing.ok) {
    return {
      ok: false,
      code: "control_branch_exists",
      message: `${config.controlBranch} already exists at ${existing.data}`,
    };
  }
  if (existing.code !== "not_found") {
    return { ok: false, code: existing.code, message: existing.message };
  }

  const files = [
    { path: "CONTROL_PLANE.md", content: BOOTSTRAP_CONTROL_PLANE_MD },
    { path: ".ae-control-bootstrap", content: BOOTSTRAP_MARKER },
  ];

  const preview: BootstrapPreview = {
    repository: expected,
    controlBranch: config.controlBranch,
    strategy: "orphan-commit",
    files: files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.content, "utf8") })),
    mainTip: mainTipSha,
  };

  if (!apply) {
    return { ok: true, dryRun: true, preview };
  }

  const entries: Array<{ path: string; mode: "100644"; type: "blob"; sha: string }> =
    [];
  for (const f of files) {
    const blob = await client.createBlob(f.content);
    if (!blob.ok) {
      return { ok: false, code: blob.code, message: blob.message };
    }
    entries.push({ path: f.path, mode: "100644", type: "blob", sha: blob.data });
  }

  const tree = await client.createTree(entries);
  if (!tree.ok) {
    return { ok: false, code: tree.code, message: tree.message };
  }

  const commit = await client.createCommit({
    message: "ae: bootstrap control plane (orphan)",
    treeSha: tree.data,
    parentShas: [],
  });
  if (!commit.ok) {
    return { ok: false, code: commit.code, message: commit.message };
  }

  const ref = await client.createRef(
    `refs/heads/${config.controlBranch}`,
    commit.data,
  );
  if (!ref.ok) {
    return { ok: false, code: ref.code, message: ref.message };
  }

  return { ok: true, dryRun: false, preview, tip: commit.data };
}
