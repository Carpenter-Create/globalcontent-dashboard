import { parseAuthorizeComment } from "./authorize-comment";
import { CONFIGURED_FOUNDER_GITHUB_ACTOR_ID } from "./closure-readiness";
import { digestContractFileBytes } from "./contract-digest";
import {
  commitPrivilegedControlEvent,
  type LedgerResult,
  type AppendEventSuccess,
  readTaskEventChain,
} from "./control-ledger";
import {
  formatContractPath,
  formatProposedPath,
} from "./control-paths";
import type { ControlStore, ControlTip } from "./control-store";
import {
  assertCanonicalContractYaml,
  parseCanonicalContractYaml,
} from "./contract-yaml";

export type AuthorizeBindingInput = {
  store: ControlStore;
  expectedTip: ControlTip;
  /** Exact AE-AUTHORIZE comment body. */
  commentBody: string;
  observedFounderActorId: number;
  expectedFounderActorId?: number;
  /** Must be "created". Edited/deleted rejected. */
  commentAction: "created" | "edited" | "deleted" | string;
  issueNumber: number;
  commentId: number;
  /** ISO-8601 timestamp for authorized_at / occurred_at. */
  createdAt: string;
};

export type AuthorizeBindingSuccess = AppendEventSuccess & {
  contractPath: string;
  contractDigest: string;
};

function fail(code: string, message: string): LedgerResult<AuthorizeBindingSuccess> {
  return { ok: false, issues: [{ code, message }] };
}

/**
 * Dry-run founder authorization binder (spec §5.2 + §4.5).
 * No network. Loads staged bytes from the store only — caller-supplied YAML
 * cannot substitute. Freezes contract bytes + appends authorize under CAS.
 */
export async function bindFounderAuthorization(
  input: AuthorizeBindingInput,
): Promise<LedgerResult<AuthorizeBindingSuccess>> {
  const expectedFounder =
    input.expectedFounderActorId ?? CONFIGURED_FOUNDER_GITHUB_ACTOR_ID;

  if (
    typeof expectedFounder !== "number" ||
    !Number.isSafeInteger(expectedFounder) ||
    expectedFounder < 1 ||
    expectedFounder !== CONFIGURED_FOUNDER_GITHUB_ACTOR_ID
  ) {
    return fail(
      "expected_founder_actor_id_invalid",
      "expected founder actor ID must be configured repository identity",
    );
  }

  if (input.commentAction !== "created") {
    return fail(
      "comment_action_not_created",
      `authorize requires comment action created, got ${input.commentAction}`,
    );
  }

  if (
    typeof input.observedFounderActorId !== "number" ||
    !Number.isSafeInteger(input.observedFounderActorId) ||
    input.observedFounderActorId !== expectedFounder
  ) {
    return fail(
      "founder_actor_mismatch",
      `observed actor ${input.observedFounderActorId} != expected ${expectedFounder}`,
    );
  }

  if (
    !Number.isInteger(input.issueNumber) ||
    input.issueNumber < 1 ||
    !Number.isInteger(input.commentId) ||
    input.commentId < 1
  ) {
    return fail(
      "issue_comment_identity_invalid",
      "issueNumber and commentId must be positive integers",
    );
  }

  const parsed = parseAuthorizeComment(input.commentBody);
  if (!parsed.ok) {
    return {
      ok: false,
      issues: parsed.errors.map((e) => ({
        code: "authorize_comment_invalid",
        message: e,
      })),
    };
  }
  const auth = parsed.value;

  const proposedPath = formatProposedPath(auth.task_id, auth.contract_version);
  const contractPath = formatContractPath(auth.task_id, auth.contract_version);

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

  // Staged-store provenance only — never accept caller-supplied standalone YAML.
  const yaml = snapshot.objects.get(proposedPath);
  if (!yaml) {
    return fail(
      "missing_staged_contract",
      `missing staged contract at ${proposedPath}`,
    );
  }

  let recomputedDigest: string;
  let stagedContract;
  try {
    assertCanonicalContractYaml(yaml);
    stagedContract = parseCanonicalContractYaml(yaml);
    recomputedDigest = digestContractFileBytes(yaml);
  } catch (e) {
    return fail("invalid_staged_contract", (e as Error).message);
  }

  if (stagedContract.task_id !== auth.task_id) {
    return fail(
      "task_id_mismatch",
      `comment task_id ${auth.task_id} != staged ${stagedContract.task_id}`,
    );
  }
  if (stagedContract.contract_version !== auth.contract_version) {
    return fail(
      "contract_version_mismatch",
      `comment version ${auth.contract_version} != staged ${stagedContract.contract_version}`,
    );
  }
  if (stagedContract.base_sha !== auth.base_sha) {
    return fail(
      "base_sha_mismatch",
      `comment base_sha ${auth.base_sha} != staged ${stagedContract.base_sha}`,
    );
  }

  if (recomputedDigest !== auth.contract_digest) {
    return fail(
      "contract_digest_mismatch",
      `comment digest ${auth.contract_digest} != staged ${recomputedDigest}`,
    );
  }

  if (snapshot.objects.has(contractPath)) {
    const existing = snapshot.objects.get(contractPath)!;
    if (existing !== yaml) {
      return fail(
        "frozen_contract_conflict",
        `frozen contract exists with different bytes for ${contractPath}`,
      );
    }
  }

  const priorChain = readTaskEventChain(snapshot.objects, auth.task_id);
  if (priorChain.ok) {
    for (const ev of priorChain.value) {
      if (
        ev.event_type === "authorize" &&
        ev.payload.contract_version === auth.contract_version
      ) {
        return fail(
          "duplicate_authorization",
          `authorize already recorded for contract version ${auth.contract_version}`,
        );
      }
    }
  } else if (priorChain.issues[0]?.code !== "empty_chain") {
    return { ok: false, issues: priorChain.issues };
  }

  const extra = new Map<string, string>();
  if (!snapshot.objects.has(contractPath)) {
    extra.set(contractPath, yaml);
  }

  const append = await commitPrivilegedControlEvent({
    store: input.store,
    expectedTip: input.expectedTip,
    taskId: auth.task_id,
    eventType: "authorize",
    payload: {
      contract_version: auth.contract_version,
      contract_digest: auth.contract_digest,
      founder_actor_id: input.observedFounderActorId,
      base_sha: auth.base_sha,
      issue_number: input.issueNumber,
      comment_id: input.commentId,
      authorized_at: input.createdAt,
    },
    occurredAt: input.createdAt,
    actor: {
      kind: "founder",
      provider: "github",
      session_or_run_id: `issue-${input.issueNumber}-comment-${input.commentId}`,
      github_actor_id: input.observedFounderActorId,
    },
    overrideActiveContract: {
      version: auth.contract_version,
      digest: auth.contract_digest,
    },
    extraObjects: extra,
  });

  if (!append.ok) return append;

  return {
    ok: true,
    value: {
      ...append.value,
      contractPath,
      contractDigest: auth.contract_digest,
    },
  };
}
