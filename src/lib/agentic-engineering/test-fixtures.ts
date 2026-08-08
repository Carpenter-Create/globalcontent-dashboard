import { withEventDigest } from "./event-digest";
import { genesisPrevEventDigest } from "./genesis";
import type { ControlEvent, ControlEventPreimage, ControlEventType } from "./event-schema";
import type { TaskContract } from "./contract-schema";

export const SAMPLE_SHA = "a".repeat(40);
export const SAMPLE_SHA_B = "b".repeat(40);
export const SAMPLE_DIGEST =
  "sha256:" + "c".repeat(64);
export const SAMPLE_DIGEST_B =
  "sha256:" + "d".repeat(64);

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
    const preimage: ControlEventPreimage = {
      schema_version: 1,
      task_id: taskId,
      sequence,
      event_type: spec.type,
      occurred_at: spec.occurredAt ?? `2026-08-08T14:00:${String(i).padStart(2, "0")}.000Z`,
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
      payload: spec.payload ?? {},
    };
    out.push(withEventDigest(preimage));
  }
  return out;
}
