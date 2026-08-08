import { VALIDATION_FLOOR_CHECK_NAMES } from "./closure-readiness";
import { withEventDigest } from "./event-digest";
import { genesisPrevEventDigest } from "./genesis";
import type {
  ControlEvent,
  ControlEventPreimage,
  ControlEventType,
} from "./event-schema";
import type { TaskContract } from "./contract-schema";

export const SAMPLE_SHA = "a".repeat(40);
export const SAMPLE_SHA_B = "b".repeat(40);
export const SAMPLE_DIGEST = "sha256:" + "c".repeat(64);
export const SAMPLE_DIGEST_B = "sha256:" + "d".repeat(64);

export function sampleContract(
  overrides: Partial<TaskContract> = {},
): TaskContract {
  return {
    schema_version: 1,
    task_id: "AE-0001",
    contract_version: 1,
    title: "Phase A sample",
    authorized_scope: ["docs/agentic-engineering only"],
    out_of_scope: ["production mutation", "GitHub workflows"],
    source_refs: [
      { path: "docs/agentic-engineering/AGENTIC_ENGINEERING_V1.md" },
    ],
    base_branch: "main",
    base_sha: SAMPLE_SHA,
    work_branch: "feat/agentic-engineering-phase-a",
    role_separation: "required",
    implementer: { agent: "cursor" },
    reviewer: { agent: "codex" },
    validation_additions: { commands: [], status_checks: [] },
    baseline_exceptions: [],
    may_draft_migration_sql: false,
    may_draft_production_runbook: false,
    dependency_addition_allowed: false,
    ci_workflow_change_allowed: false,
    review_intensity: "strict",
    max_remediation_rounds: 5,
    acceptance_criteria: [
      { id: "AC1", description: "Phase A primitives tested" },
    ],
    ...overrides,
  };
}

export function authorizePayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    contract_version: 1,
    contract_digest: SAMPLE_DIGEST,
    founder_actor_id: 42,
    base_sha: SAMPLE_SHA,
    issue_number: 7,
    comment_id: 99,
    authorized_at: "2026-08-08T14:00:00.000Z",
    ...overrides,
  };
}

/** Default strict payloads per event type for chain fixtures. */
export function defaultEventPayload(
  type: ControlEventType,
): Record<string, unknown> {
  switch (type) {
    case "contract_staged":
      return {
        contract_version: 1,
        contract_digest: SAMPLE_DIGEST,
      };
    case "authorize":
      return authorizePayload();
    case "implementation_started":
      return {
        session_or_run_id: "impl-session-1",
        provider: "cursor",
        pr_number: 12,
      };
    case "implementation_declared":
      return {
        implementation_sha: SAMPLE_SHA,
        pr_number: 12,
        session_or_run_id: "impl-session-1",
      };
    case "validation_completed":
      return {
        outcome: "success",
        validated_sha: SAMPLE_SHA,
        evidence_refs: [{ kind: "check_run", id: "cr-1" }],
      };
    case "review_started":
      return {
        target_sha: SAMPLE_SHA,
        session_or_run_id: "review-session-1",
        provider: "codex",
      };
    case "review_completed":
      return {
        reviewed_sha: SAMPLE_SHA,
        status: "approved",
        session_or_run_id: "review-session-1",
        provider: "codex",
        evidence_ref: "review-ev-1",
      };
    case "remediation_required":
      return {
        reason: "validation or review failed",
        finding_ids: ["F1"],
      };
    case "remediation_started":
      return {
        session_or_run_id: "impl-session-2",
        provider: "cursor",
        round: 1,
      };
    case "founder_decision_required":
      return { question: "scope?" };
    case "finding_disposition":
      return {
        finding_id: "F1",
        disposition: "accepted_by_founder",
        founder_actor_id: 42,
      };
    case "stale_review":
      return {
        prior_reviewed_sha: SAMPLE_SHA,
        current_head_sha: SAMPLE_SHA_B,
      };
    case "closure_invalidated":
      return {
        prior_head_sha: SAMPLE_SHA,
        current_head_sha: SAMPLE_SHA_B,
        reason: "head moved",
      };
    case "founder_review_ready":
      return {
        implementation_sha: SAMPLE_SHA,
        validated_sha: SAMPLE_SHA,
        reviewed_sha: SAMPLE_SHA,
        active_contract_version: 1,
        active_contract_digest: SAMPLE_DIGEST,
        closure_evidence_ref: "closure-ev-1",
        predicate_result_id: "pred-1",
      };
    case "blocked":
      return { reason: "external blocker", blocker_class: "external" };
    case "critical_failure":
      return { reason: "integrity failure", failure_class: "integrity" };
    case "paused":
      return { reason: "founder pause", founder_actor_id: 42 };
    case "resumed":
      return { founder_actor_id: 42 };
    case "cancelled":
      return { reason: "abandoned", founder_actor_id: 42 };
    case "closed":
      return { merge_sha: SAMPLE_SHA, founder_actor_id: 42 };
    default: {
      const _x: never = type;
      void _x;
      return {};
    }
  }
}

export function chainEvents(
  specs: Array<{
    type: ControlEventType;
    payload?: Record<string, unknown>;
    activeDigest?: string;
    activeVersion?: number;
    occurredAt?: string;
  }>,
  taskId = "AE-0001",
): ControlEvent[] {
  const out: ControlEvent[] = [];
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    const sequence = i + 1;
    const payload = {
      ...defaultEventPayload(spec.type),
      ...(spec.payload ?? {}),
    };
    const preimage = {
      schema_version: 1,
      task_id: taskId,
      sequence,
      event_type: spec.type,
      occurred_at:
        spec.occurredAt ??
        `2026-08-08T14:00:${String(i).padStart(2, "0")}.000Z`,
      actor: {
        kind: "orchestrator",
        provider: "test",
        session_or_run_id: `run-${i}`,
        github_actor_id: null,
      },
      active_contract_version: spec.activeVersion ?? 1,
      active_contract_digest: spec.activeDigest ?? SAMPLE_DIGEST,
      prev_event_digest:
        sequence === 1
          ? genesisPrevEventDigest(taskId)
          : out[i - 1].event_digest,
      payload,
    } as ControlEventPreimage;
    out.push(withEventDigest(preimage));
  }
  return out;
}

export function floorCheckResults(sha = SAMPLE_SHA) {
  return VALIDATION_FLOOR_CHECK_NAMES.map((name, i) => ({
    name,
    sha,
    conclusion: "success" as const,
    checkRunId: `cr-${i + 1}`,
  }));
}
