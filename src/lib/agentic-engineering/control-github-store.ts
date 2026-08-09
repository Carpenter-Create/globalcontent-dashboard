import {
  readControlBranch,
  type ControlBranchRead,
} from "./control-github-read";
import { compareAndSwapControlBranch } from "./control-github-write";
import type { AgenticGitHubConfig } from "./github-config";
import type { GitHubRestClient } from "./github-rest";
import { registerWritableControlStore } from "./internal/writable-registry";
import {
  LedgerIntegrityError,
  type ControlSnapshot,
  type ControlStore,
  type ControlTip,
} from "./control-store";

/**
 * Live GitHub-backed ControlStore for ae/control.
 * Tip identity is the git commit SHA of refs/heads/<controlBranch>.
 * Public surface is read-only; CAS is registered internally for ledger writers.
 */
export function openGitHubControlStore(
  client: GitHubRestClient,
  config: AgenticGitHubConfig,
): ControlStore {
  async function load(): Promise<ControlBranchRead> {
    const read = await readControlBranch(client, config);
    if (!read.ok) {
      throw new LedgerIntegrityError(read.message);
    }
    return read.value;
  }

  const store: ControlStore = {
    async getTip(): Promise<ControlTip> {
      const tip = await client.getBranchTip(config.controlBranch);
      if (!tip.ok) {
        throw new LedgerIntegrityError(tip.message);
      }
      return tip.data;
    },
    async getSnapshot(): Promise<ControlSnapshot> {
      const read = await load();
      return { tip: read.tip, objects: read.objects };
    },
    async readObject(path: string): Promise<string | null> {
      const read = await load();
      return read.objects.get(path) ?? null;
    },
  };

  registerWritableControlStore(store, {
    async unsafeCompareAndSwap(expectedTip, nextObjects) {
      return compareAndSwapControlBranch({
        client,
        config,
        expectedTip,
        nextObjects,
        commitMessage: "ae: control-plane CAS update",
      });
    },
  });

  return store;
}
