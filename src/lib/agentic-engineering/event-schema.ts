import { z } from "zod";

import { gitShaSchema, sha256DigestSchema } from "./contract-schema";

export const CONTROL_EVENT_TYPES = [
  "contract_staged",
  "authorize",
  "implementation_started",
  "implementation_declared",
  "validation_completed",
  "review_started",
  "review_completed",
  "remediation_required",
  "remediation_started",
  "founder_decision_required",
  "finding_disposition",
  "stale_review",
  "closure_invalidated",
  "founder_review_ready",
  "blocked",
  "critical_failure",
  "paused",
  "resumed",
  "cancelled",
  "closed",
] as const;

export type ControlEventType = (typeof CONTROL_EVENT_TYPES)[number];

export const actorSchema = z.strictObject({
  kind: z.enum([
    "founder",
    "orchestrator",
    "implementer",
    "reviewer",
    "system",
  ]),
  provider: z.string().min(1).nullable(),
  session_or_run_id: z.string().min(1).nullable(),
  github_actor_id: z.number().int().positive().nullable(),
});

const taskIdSchema = z.string().regex(/^AE-[0-9]{4,}$/);

const envelope = {
  schema_version: z.literal(1),
  task_id: taskIdSchema,
  sequence: z.number().int().positive(),
  occurred_at: z.string().datetime({ offset: true }),
  actor: actorSchema,
  active_contract_version: z.number().int().positive(),
  active_contract_digest: sha256DigestSchema,
  prev_event_digest: z.string().min(1),
  event_digest: sha256DigestSchema,
} as const;

const evidenceRefSchema = z.strictObject({
  kind: z.enum(["check_run", "log", "artifact", "note"]),
  id: z.string().min(1),
});

export const authorizePayloadSchema = z.strictObject({
  contract_version: z.number().int().positive(),
  contract_digest: sha256DigestSchema,
  founder_actor_id: z.number().int().positive(),
  base_sha: gitShaSchema,
  issue_number: z.number().int().positive(),
  comment_id: z.number().int().positive(),
  authorized_at: z.string().datetime({ offset: true }),
});

export const contractStagedPayloadSchema = z.strictObject({
  contract_version: z.number().int().positive(),
  contract_digest: sha256DigestSchema,
});

export const implementationStartedPayloadSchema = z.strictObject({
  session_or_run_id: z.string().min(1),
  provider: z.string().min(1),
  pr_number: z.number().int().positive().optional(),
});

export const implementationDeclaredPayloadSchema = z.strictObject({
  implementation_sha: gitShaSchema,
  pr_number: z.number().int().positive(),
  session_or_run_id: z.string().min(1),
});

export const validationCompletedPayloadSchema = z.strictObject({
  outcome: z.enum(["success", "failure"]),
  validated_sha: gitShaSchema,
  evidence_refs: z.array(evidenceRefSchema).min(1),
});

export const reviewStartedPayloadSchema = z.strictObject({
  target_sha: gitShaSchema,
  session_or_run_id: z.string().min(1),
  provider: z.string().min(1),
});

export const reviewCompletedPayloadSchema = z.strictObject({
  reviewed_sha: gitShaSchema,
  status: z.enum(["approved", "changes_requested"]),
  session_or_run_id: z.string().min(1),
  provider: z.string().min(1),
  evidence_ref: z.string().min(1),
});

export const remediationRequiredPayloadSchema = z.strictObject({
  reason: z.string().min(1),
  finding_ids: z.array(z.string().min(1)).min(1),
});

export const remediationStartedPayloadSchema = z.strictObject({
  session_or_run_id: z.string().min(1),
  provider: z.string().min(1),
  round: z.number().int().positive(),
});

export const founderDecisionRequiredPayloadSchema = z.strictObject({
  question: z.string().min(1),
  context_ref: z.string().min(1).optional(),
});

export const findingDispositionPayloadSchema = z.strictObject({
  finding_id: z.string().min(1),
  disposition: z.enum(["accepted_by_founder", "deferred", "wont_fix_founder"]),
  founder_actor_id: z.number().int().positive(),
});

export const staleReviewPayloadSchema = z.strictObject({
  prior_reviewed_sha: gitShaSchema,
  current_head_sha: gitShaSchema,
});

export const closureInvalidatedPayloadSchema = z.strictObject({
  prior_head_sha: gitShaSchema,
  current_head_sha: gitShaSchema,
  reason: z.string().min(1),
});

export const founderReviewReadyPayloadSchema = z.strictObject({
  implementation_sha: gitShaSchema,
  validated_sha: gitShaSchema,
  reviewed_sha: gitShaSchema,
  active_contract_version: z.number().int().positive(),
  active_contract_digest: sha256DigestSchema,
  closure_evidence_ref: z.string().min(1),
  predicate_result_id: z.string().min(1),
});

export const blockedPayloadSchema = z.strictObject({
  reason: z.string().min(1),
  blocker_class: z.string().min(1),
});

export const criticalFailurePayloadSchema = z.strictObject({
  reason: z.string().min(1),
  failure_class: z.string().min(1),
});

export const pausedPayloadSchema = z.strictObject({
  reason: z.string().min(1),
  founder_actor_id: z.number().int().positive(),
});

export const resumedPayloadSchema = z.strictObject({
  founder_actor_id: z.number().int().positive(),
  resume_to_hint: z.string().min(1).optional(),
});

export const cancelledPayloadSchema = z.strictObject({
  reason: z.string().min(1),
  founder_actor_id: z.number().int().positive(),
});

export const closedPayloadSchema = z.strictObject({
  merge_sha: gitShaSchema,
  founder_actor_id: z.number().int().positive(),
});

function variant<T extends ControlEventType, P extends z.ZodType>(
  event_type: T,
  payload: P,
) {
  return z.strictObject({
    ...envelope,
    event_type: z.literal(event_type),
    payload,
  });
}

export const controlEventSchema = z.discriminatedUnion("event_type", [
  variant("contract_staged", contractStagedPayloadSchema),
  variant("authorize", authorizePayloadSchema),
  variant("implementation_started", implementationStartedPayloadSchema),
  variant("implementation_declared", implementationDeclaredPayloadSchema),
  variant("validation_completed", validationCompletedPayloadSchema),
  variant("review_started", reviewStartedPayloadSchema),
  variant("review_completed", reviewCompletedPayloadSchema),
  variant("remediation_required", remediationRequiredPayloadSchema),
  variant("remediation_started", remediationStartedPayloadSchema),
  variant("founder_decision_required", founderDecisionRequiredPayloadSchema),
  variant("finding_disposition", findingDispositionPayloadSchema),
  variant("stale_review", staleReviewPayloadSchema),
  variant("closure_invalidated", closureInvalidatedPayloadSchema),
  variant("founder_review_ready", founderReviewReadyPayloadSchema),
  variant("blocked", blockedPayloadSchema),
  variant("critical_failure", criticalFailurePayloadSchema),
  variant("paused", pausedPayloadSchema),
  variant("resumed", resumedPayloadSchema),
  variant("cancelled", cancelledPayloadSchema),
  variant("closed", closedPayloadSchema),
]);

export type ControlEvent = z.infer<typeof controlEventSchema>;

/** Preimage = event without event_digest (for digest computation). */
export type ControlEventPreimage = Omit<ControlEvent, "event_digest">;

function variantPreimage<T extends ControlEventType, P extends z.ZodType>(
  event_type: T,
  payload: P,
) {
  const { event_digest: _d, ...rest } = envelope;
  void _d;
  return z.strictObject({
    ...rest,
    event_type: z.literal(event_type),
    payload,
  });
}

export const controlEventPreimageSchema = z.discriminatedUnion("event_type", [
  variantPreimage("contract_staged", contractStagedPayloadSchema),
  variantPreimage("authorize", authorizePayloadSchema),
  variantPreimage("implementation_started", implementationStartedPayloadSchema),
  variantPreimage("implementation_declared", implementationDeclaredPayloadSchema),
  variantPreimage("validation_completed", validationCompletedPayloadSchema),
  variantPreimage("review_started", reviewStartedPayloadSchema),
  variantPreimage("review_completed", reviewCompletedPayloadSchema),
  variantPreimage("remediation_required", remediationRequiredPayloadSchema),
  variantPreimage("remediation_started", remediationStartedPayloadSchema),
  variantPreimage("founder_decision_required", founderDecisionRequiredPayloadSchema),
  variantPreimage("finding_disposition", findingDispositionPayloadSchema),
  variantPreimage("stale_review", staleReviewPayloadSchema),
  variantPreimage("closure_invalidated", closureInvalidatedPayloadSchema),
  variantPreimage("founder_review_ready", founderReviewReadyPayloadSchema),
  variantPreimage("blocked", blockedPayloadSchema),
  variantPreimage("critical_failure", criticalFailurePayloadSchema),
  variantPreimage("paused", pausedPayloadSchema),
  variantPreimage("resumed", resumedPayloadSchema),
  variantPreimage("cancelled", cancelledPayloadSchema),
  variantPreimage("closed", closedPayloadSchema),
]);

export function parseControlEvent(input: unknown): ControlEvent {
  return controlEventSchema.parse(input);
}

export function safeParseControlEvent(input: unknown) {
  return controlEventSchema.safeParse(input);
}

export function parseControlEventPreimage(input: unknown): ControlEventPreimage {
  return controlEventPreimageSchema.parse(input);
}
