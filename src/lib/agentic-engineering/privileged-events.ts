import type { ControlEventType } from "./event-schema";

/**
 * Authority-bearing / founder-only event types.
 * Must not be admitted through the generic append API or CLI append-event.
 */
export const PRIVILEGED_EVENT_TYPES = [
  "authorize",
  "finding_disposition",
  "founder_review_ready",
  "closed",
  "paused",
  "resumed",
  "cancelled",
  /** Staging has its own transaction API. */
  "contract_staged",
] as const satisfies readonly ControlEventType[];

export type PrivilegedEventType = (typeof PRIVILEGED_EVENT_TYPES)[number];

const PRIVILEGED_SET = new Set<string>(PRIVILEGED_EVENT_TYPES);

/** Operational events allowed via generic appendControlEvent / CLI append-event. */
export const OPERATIONAL_EVENT_TYPES = [
  "implementation_started",
  "implementation_declared",
  "validation_completed",
  "review_started",
  "review_completed",
  "remediation_required",
  "remediation_started",
  "founder_decision_required",
  "stale_review",
  "closure_invalidated",
  "blocked",
  "critical_failure",
] as const satisfies readonly ControlEventType[];

export type OperationalEventType = (typeof OPERATIONAL_EVENT_TYPES)[number];

const OPERATIONAL_SET = new Set<string>(OPERATIONAL_EVENT_TYPES);

export function isPrivilegedEventType(type: string): type is PrivilegedEventType {
  return PRIVILEGED_SET.has(type);
}

export function isOperationalEventType(
  type: string,
): type is OperationalEventType {
  return OPERATIONAL_SET.has(type);
}
