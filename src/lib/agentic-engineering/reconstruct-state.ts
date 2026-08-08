import {
  assertCanonicalContractYaml,
  parseCanonicalContractYaml,
} from "./contract-yaml";
import { digestContractFileBytes } from "./contract-digest";
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

const AUTHORIZED_OR_LATER: ReadonlySet<FoldedTaskState["state"]> = new Set([
  "AUTHORIZED",
  "IMPLEMENTING",
  "VALIDATING",
  "REVIEWING",
  "REMEDIATION_REQUIRED",
  "REMEDIATING",
  "FOUNDER_DECISION_REQUIRED",
  "FOUNDER_REVIEW",
  "BLOCKED",
  "CRITICAL_FAILURE",
  "PAUSED",
  "CLOSED",
  "CANCELLED",
]);

/**
 * Reconstruct task state from frozen contract + verified event chain.
 * Uses Phase A foldTaskState. No GitHub I/O.
 * For AUTHORIZED and later states, frozen contract authority is required.
 */
export async function reconstructTaskState(
  store: ControlStore,
  taskId: string,
): Promise<ReconstructResult> {
  let snapshot;
  try {
    snapshot = await store.getSnapshot();
  } catch (e) {
    return {
      ok: false,
      issues: [
        {
          code: "integrity_failure",
          message: e instanceof Error ? e.message : String(e),
        },
      ],
    };
  }

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
  const digest = fold.state.activeContractDigest;
  const frozenContractPath =
    version != null ? formatContractPath(taskId, version) : null;

  if (AUTHORIZED_OR_LATER.has(fold.state.state)) {
    if (version == null || digest == null || frozenContractPath == null) {
      return {
        ok: false,
        issues: [
          {
            code: "frozen_contract_identity_missing",
            message:
              "AUTHORIZED+ reconstruction requires active contract version and digest",
          },
        ],
      };
    }
    const frozenBytes = snapshot.objects.get(frozenContractPath);
    if (!frozenBytes) {
      return {
        ok: false,
        issues: [
          {
            code: "frozen_contract_missing",
            message: `missing frozen contract at ${frozenContractPath}`,
          },
        ],
      };
    }
    let recomputed: string;
    let parsed;
    try {
      assertCanonicalContractYaml(frozenBytes);
      parsed = parseCanonicalContractYaml(frozenBytes);
      recomputed = digestContractFileBytes(frozenBytes);
    } catch (e) {
      return {
        ok: false,
        issues: [
          {
            code: "frozen_contract_malformed",
            message: e instanceof Error ? e.message : String(e),
          },
        ],
      };
    }
    if (recomputed !== digest) {
      return {
        ok: false,
        issues: [
          {
            code: "frozen_contract_digest_mismatch",
            message: `frozen digest ${recomputed} != active ${digest}`,
          },
        ],
      };
    }
    if (parsed.task_id !== taskId || parsed.contract_version !== version) {
      return {
        ok: false,
        issues: [
          {
            code: "frozen_contract_identity_mismatch",
            message: `frozen contract identity ${parsed.task_id}/v${parsed.contract_version} != ${taskId}/v${version}`,
          },
        ],
      };
    }
  }

  const last = chain.value[chain.value.length - 1];
  const hasFrozen =
    frozenContractPath != null && snapshot.objects.has(frozenContractPath);

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
