import {
  assertCanonicalContractYaml,
  parseCanonicalContractYaml,
} from "./contract-yaml";
import { digestContractFileBytes } from "./contract-digest";
import {
  type ControlStore,
  type ControlTip,
  cloneObjects,
  contentDigestMap,
} from "./control-store";
import {
  formatContractPath,
  formatProposedPath,
} from "./control-paths";
import type { ControlEvent, ControlEventType } from "./event-schema";
import { getWritableControlOps } from "./internal/writable-registry";
import {
  commitOperationalControlEvent,
  commitPrivilegedControlEvent,
  readTaskEventChain,
  type AppendEventSuccess,
  type LedgerIssue,
  type LedgerResult,
} from "./internal/commit-control-event";
import { verifyProtectedObjectDelta } from "./protected-delta";

export type { LedgerIssue, LedgerResult, AppendEventSuccess };
export { readTaskEventChain };

export type AppendEventInput = {
  store: ControlStore;
  expectedTip: ControlTip;
  taskId: string;
  eventType: ControlEventType;
  payload: Record<string, unknown>;
  occurredAt: string;
  actor: ControlEvent["actor"];
  claimedActiveContractVersion?: number;
  claimedActiveContractDigest?: string;
};

function fail<T = never>(code: string, message: string): LedgerResult<T> {
  return { ok: false, issues: [{ code, message }] };
}

/**
 * Append an operational control event under CAS + integrity rules (spec §4.5).
 * Rejects privileged / founder-only event types.
 */
export async function appendControlEvent(
  input: AppendEventInput,
): Promise<LedgerResult<AppendEventSuccess>> {
  return commitOperationalControlEvent(input);
}

export type StageContractInput = {
  store: ControlStore;
  expectedTip: ControlTip;
  taskId: string;
  contractVersion: number;
  contractYaml: string;
  occurredAt: string;
  actor?: ControlEvent["actor"];
};

/**
 * Stage canonical contract bytes under proposed/ and append contract_staged.
 * Destination path task/version must match YAML contents.
 */
export async function stageContract(
  input: StageContractInput,
): Promise<
  LedgerResult<AppendEventSuccess & { proposedPath: string; digest: string }>
> {
  let digest: string;
  let parsed;
  try {
    assertCanonicalContractYaml(input.contractYaml);
    parsed = parseCanonicalContractYaml(input.contractYaml);
    digest = digestContractFileBytes(input.contractYaml);
  } catch (e) {
    return fail("invalid_contract", (e as Error).message);
  }

  if (parsed.task_id !== input.taskId) {
    return fail(
      "staged_path_task_mismatch",
      `contract.task_id ${parsed.task_id} != destination ${input.taskId}`,
    );
  }
  if (parsed.contract_version !== input.contractVersion) {
    return fail(
      "staged_path_version_mismatch",
      `contract.contract_version ${parsed.contract_version} != destination ${input.contractVersion}`,
    );
  }

  const proposedPath = formatProposedPath(input.taskId, input.contractVersion);
  const contractPath = formatContractPath(input.taskId, input.contractVersion);
  let snapshot;
  try {
    snapshot = await input.store.getSnapshot();
  } catch (e) {
    return fail(
      "integrity_failure",
      e instanceof Error ? e.message : String(e),
    );
  }
  if (snapshot.objects.has(contractPath)) {
    return fail(
      "contract_version_exists",
      `frozen contract already exists: ${contractPath}`,
    );
  }

  const result = await commitPrivilegedControlEvent({
    store: input.store,
    expectedTip: input.expectedTip,
    taskId: input.taskId,
    eventType: "contract_staged",
    payload: {
      contract_version: input.contractVersion,
      contract_digest: digest,
    },
    occurredAt: input.occurredAt,
    actor: input.actor ?? {
      kind: "orchestrator",
      provider: "phase-b-dry-run",
      session_or_run_id: "stage-contract",
      github_actor_id: null,
    },
    overrideActiveContract: {
      version: input.contractVersion,
      digest,
    },
    extraObjects: new Map([[proposedPath, input.contractYaml]]),
  });

  if (!result.ok) return result;
  return {
    ok: true,
    value: { ...result.value, proposedPath, digest },
  };
}

export type AddDerivedClosureInput = {
  store: ControlStore;
  expectedTip: ControlTip;
  path: string;
  content: string;
};

/**
 * Add/refresh a derived closure object (closures/** only) under CAS.
 */
export async function addDerivedClosure(
  input: AddDerivedClosureInput,
): Promise<LedgerResult<{ tip: ControlTip; path: string }>> {
  if (!input.path.startsWith("closures/") || input.path.includes("..")) {
    return fail("invalid_derived_path", "path must be under closures/");
  }
  const ops = getWritableControlOps(input.store);
  if (!ops) {
    return fail(
      "store_not_writable",
      "control store is not registered as a writable ledger store",
    );
  }

  let snapshot;
  try {
    snapshot = await input.store.getSnapshot();
  } catch (e) {
    return fail(
      "integrity_failure",
      e instanceof Error ? e.message : String(e),
    );
  }
  if (snapshot.tip !== input.expectedTip) {
    return fail(
      "stale_tip",
      `expected tip ${input.expectedTip}, observed ${snapshot.tip}`,
    );
  }

  const next = cloneObjects(snapshot.objects);
  next.set(input.path, input.content);
  const delta = verifyProtectedObjectDelta(
    contentDigestMap(snapshot.objects),
    contentDigestMap(next),
  );
  if (!delta.ok) {
    return {
      ok: false,
      issues: delta.issues.map((i) => ({ code: i.code, message: i.message })),
    };
  }

  const cas = await ops.unsafeCompareAndSwap(input.expectedTip, next);
  if (!cas.ok) return fail(cas.code, cas.message);
  return { ok: true, value: { tip: cas.tip, path: input.path } };
}
