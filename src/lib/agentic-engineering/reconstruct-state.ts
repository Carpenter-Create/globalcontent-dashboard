import { formatContractPath } from "./control-paths";
import { readTaskEventChain } from "./control-ledger";
import type { ControlStore } from "./control-store";
import type { ControlEvent } from "./event-schema";
import { foldTaskState, type FoldedTaskState } from "./state-fold";

export type ReconstructedTaskState = {
  taskId: string;
  tip: string;
  activeContractVersion: number | null;
  activeContractDigest: string | null;
  frozenContractPath: string | null;
  state: FoldedTaskState["state"];
  latestSequence: number;
  latestEventDigest: string | null;
  implementationSha: string | null;
  validatedSha: string | null;
  reviewedSha: string | null;
  reviewStatus: FoldedTaskState["reviewStatus"];
  remediationCount: number;
  dispositions: Array<{
    findingId: string;
    disposition: string;
    founderActorId: number;
    sequence: number;
    eventDigest: string;
  }>;
  folded: FoldedTaskState;
  events: ControlEvent[];
};

export type ReconstructResult =
  | { ok: true; value: ReconstructedTaskState }
  | { ok: false; issues: { code: string; message: string }[] };

/**
 * Reconstruct task state from frozen contract + verified event chain.
 * Uses Phase A foldTaskState. No GitHub I/O.
 */
export async function reconstructTaskState(
  store: ControlStore,
  taskId: string,
): Promise<ReconstructResult> {
  const snapshot = await store.getSnapshot();
  const chain = readTaskEventChain(snapshot.objects, taskId);
  if (!chain.ok) {
    return { ok: false, issues: chain.issues };
  }

  const fold = foldTaskState(chain.value);
  if (!fold.ok) {
    return { ok: false, issues: fold.issues };
  }

  const dispositions: ReconstructedTaskState["dispositions"] = [];
  for (const ev of chain.value) {
    if (ev.event_type === "finding_disposition") {
      dispositions.push({
        findingId: ev.payload.finding_id,
        disposition: ev.payload.disposition,
        founderActorId: ev.payload.founder_actor_id,
        sequence: ev.sequence,
        eventDigest: ev.event_digest,
      });
    }
  }

  const version = fold.state.activeContractVersion;
  const frozenContractPath =
    version != null ? formatContractPath(taskId, version) : null;
  const hasFrozen =
    frozenContractPath != null && snapshot.objects.has(frozenContractPath);

  const last = chain.value[chain.value.length - 1];

  return {
    ok: true,
    value: {
      taskId,
      tip: snapshot.tip,
      activeContractVersion: fold.state.activeContractVersion,
      activeContractDigest: fold.state.activeContractDigest,
      frozenContractPath: hasFrozen ? frozenContractPath : null,
      state: fold.state.state,
      latestSequence: fold.state.lastEventSequence,
      latestEventDigest: last?.event_digest ?? null,
      implementationSha: fold.state.implementationSha,
      validatedSha: fold.state.validatedSha,
      reviewedSha: fold.state.reviewedSha,
      reviewStatus: fold.state.reviewStatus,
      remediationCount: fold.state.remediationCount,
      dispositions,
      folded: fold.state,
      events: chain.value,
    },
  };
}
