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

/**
 * Control event envelope. Payload is typed lightly in Phase A (record) to avoid
 * over-modeling; event_type enum covers the state machine vocabulary.
 */
export const controlEventSchema = z.strictObject({
  schema_version: z.literal(1),
  task_id: z.string().regex(/^AE-[0-9]{4,}$/),
  sequence: z.number().int().positive(),
  event_type: z.enum(CONTROL_EVENT_TYPES),
  occurred_at: z.string().datetime({ offset: true }),
  actor: actorSchema,
  active_contract_version: z.number().int().positive(),
  active_contract_digest: sha256DigestSchema,
  prev_event_digest: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  event_digest: sha256DigestSchema,
});

/** Event without digest — used when computing digest. */
export const controlEventPreimageSchema = controlEventSchema.omit({
  event_digest: true,
});

export type ControlEvent = z.infer<typeof controlEventSchema>;
export type ControlEventPreimage = z.infer<typeof controlEventPreimageSchema>;

export function parseControlEvent(input: unknown): ControlEvent {
  return controlEventSchema.parse(input);
}

export function safeParseControlEvent(input: unknown) {
  return controlEventSchema.safeParse(input);
}

/** Optional helpers for common payload shapes (not exclusive). */
export const authorizePayloadSchema = z.strictObject({
  contract_version: z.number().int().positive(),
  contract_digest: sha256DigestSchema,
  founder_actor_id: z.number().int().positive(),
  base_sha: gitShaSchema,
  issue_number: z.number().int().positive(),
  comment_id: z.number().int().positive(),
  authorized_at: z.string().datetime({ offset: true }),
});
