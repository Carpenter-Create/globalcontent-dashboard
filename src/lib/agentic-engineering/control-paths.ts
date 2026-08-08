/**
 * Strict control-plane path grammar (Phase A conceptual layout).
 *
 * - contracts/<task_id>/v<positive-integer>.yaml
 * - events/<task_id>/<6-digit-seq>-<event_type>.json
 * - closures/<task_id>/<40-hex-sha>.md
 * - proposed/<task_id>/v<positive-integer>.yaml
 */

export const TASK_ID_RE = /^AE-[0-9]{4,}$/;
export const EVENT_TYPES_FOR_PATH = [
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

const EVENT_TYPE_ALT = EVENT_TYPES_FOR_PATH.join("|");

const CONTRACT_RE = new RegExp(
  `^contracts/(AE-[0-9]{4,})/v([1-9][0-9]*)\\.yaml$`,
);
const EVENT_RE = new RegExp(
  `^events/(AE-[0-9]{4,})/([0-9]{6})-(${EVENT_TYPE_ALT})\\.json$`,
);
const CLOSURE_RE = new RegExp(
  `^closures/(AE-[0-9]{4,})/([0-9a-f]{40})\\.md$`,
);
const PROPOSED_RE = new RegExp(
  `^proposed/(AE-[0-9]{4,})/v([1-9][0-9]*)\\.yaml$`,
);

export type ControlPathClass =
  | "contract"
  | "event"
  | "closure"
  | "proposed";

export type ParsedControlPath =
  | { ok: true; path: string; class: ControlPathClass; taskId: string }
  | { ok: false; path: string; reason: string };

function hasPathBypass(path: string): string | null {
  if (path.startsWith("/")) return "leading slash";
  if (path.includes("\\")) return "backslash";
  if (path.includes("//")) return "repeated separators";
  if (path.split("/").some((p) => p === "" || p === "." || p === "..")) {
    return "empty or relative segment";
  }
  return null;
}

export function parseControlPath(path: string): ParsedControlPath {
  const bypass = hasPathBypass(path);
  if (bypass) return { ok: false, path, reason: bypass };

  let m = CONTRACT_RE.exec(path);
  if (m) return { ok: true, path, class: "contract", taskId: m[1] };
  m = EVENT_RE.exec(path);
  if (m) return { ok: true, path, class: "event", taskId: m[1] };
  m = CLOSURE_RE.exec(path);
  if (m) return { ok: true, path, class: "closure", taskId: m[1] };
  m = PROPOSED_RE.exec(path);
  if (m) return { ok: true, path, class: "proposed", taskId: m[1] };

  return { ok: false, path, reason: "unrecognized control-plane path" };
}

export function isAuthorityPath(path: string): boolean {
  const p = parseControlPath(path);
  return p.ok && (p.class === "contract" || p.class === "event");
}

export function isDerivedPath(path: string): boolean {
  const p = parseControlPath(path);
  return p.ok && (p.class === "closure" || p.class === "proposed");
}

export function formatEventPath(
  taskId: string,
  sequence: number,
  eventType: (typeof EVENT_TYPES_FOR_PATH)[number],
): string {
  if (!TASK_ID_RE.test(taskId)) throw new Error("bad task id");
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999999) {
    throw new Error("sequence out of event filename range");
  }
  return `events/${taskId}/${String(sequence).padStart(6, "0")}-${eventType}.json`;
}

export function formatContractPath(taskId: string, version: number): string {
  return `contracts/${taskId}/v${version}.yaml`;
}
