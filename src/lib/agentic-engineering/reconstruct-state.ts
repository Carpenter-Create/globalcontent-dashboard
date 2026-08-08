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

/**
 * Derive whether authorization has occurred from verified event history.
 * Do not use the current fold state name as the authorization test — BLOCKED /
 * PAUSED / CANCELLED can occur before or after authorize.
 */
function findVerifiedAuthorization(events: ControlEvent[]): {
  version: number;
  digest: string;
} | null {
  let latest: { version: number; digest: string } | null = null;
  for (const ev of events) {
    if (ev.event_type === "authorize") {
      latest = {
        version: ev.payload.contract_version,
        digest: ev.payload.contract_digest,
      };
    }
  }
  return latest;
}

/**
 * Reconstruct task state from frozen contract + verified event chain.
 * Uses Phase A foldTaskState. No GitHub I/O.
 * Frozen canonical contract is required only when a verified authorize event exists.
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

  const authorization = findVerifiedAuthorization(chain.value);
  let frozenContractPath: string | null = null;

  if (authorization) {
    // Active identity comes from the folded verified chain (rooted in authorize).
    const activeVersion = fold.state.activeContractVersion ?? authorization.version;
    const activeDigest = fold.state.activeContractDigest ?? authorization.digest;
    frozenContractPath = formatContractPath(taskId, activeVersion);

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
    if (recomputed !== activeDigest) {
      return {
        ok: false,
        issues: [
          {
            code: "frozen_contract_digest_mismatch",
            message: `frozen digest ${recomputed} != active ${activeDigest}`,
          },
        ],
      };
    }
    if (
      parsed.task_id !== taskId ||
      parsed.contract_version !== activeVersion
    ) {
      return {
        ok: false,
        issues: [
          {
            code: "frozen_contract_identity_mismatch",
            message: `frozen contract identity ${parsed.task_id}/v${parsed.contract_version} != ${taskId}/v${activeVersion}`,
          },
        ],
      };
    }
  } else {
    // Pre-authorization: no frozen contract required.
    const version = fold.state.activeContractVersion;
    if (version != null) {
      const candidate = formatContractPath(taskId, version);
      if (snapshot.objects.has(candidate)) {
        frozenContractPath = candidate;
      }
    }
  }

  const last = chain.value[chain.value.length - 1];

  return {
    ok: true,
    value: {
      taskId,
      tip: snapshot.tip,
      activeContractVersion: fold.state.activeContractVersion,
      activeContractDigest: fold.state.activeContractDigest,
      frozenContractPath,
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
