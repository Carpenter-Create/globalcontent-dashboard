import type { Database } from "@/lib/supabase/database.types";

export type TranscodeStatus = Database["public"]["Enums"]["transcode_status"];

/** Same threshold the poll uses for its stuck-jobs count (60 minutes). */
export const TRANSCODE_STUCK_THRESHOLD_MS = 60 * 60 * 1000;

/** Statuses that are still in flight — the only ones that can read as stuck. */
export const TRANSCODE_ACTIVE_STATUSES: readonly TranscodeStatus[] = ["submitted", "running"];

/** Approved Task 6A operator-facing copy — do not invent variants in JSX. */
export const TRANSCODE_PANEL_HEADING = "Proxy jobs";
export const TRANSCODE_PANEL_EMPTY = "No proxy jobs.";
export const TRANSCODE_STUCK_MARKER = "Stuck";

/** Statuses that may be retried (Task 6B). Active and complete jobs must never retry. */
export const TRANSCODE_RETRYABLE_STATUSES: readonly TranscodeStatus[] = [
  "failed",
  "submit_failed",
];

/** Approved Task 6B retry copy — do not invent variants in JSX or the action. */
export const TRANSCODE_RETRY_LABEL = "Retry";
export const TRANSCODE_RETRY_PENDING = "Retrying…";
export const TRANSCODE_RETRY_UNAUTHENTICATED = "Not authenticated.";
export const TRANSCODE_RETRY_INELIGIBLE = "This job cannot be retried.";
export const TRANSCODE_RETRY_NOT_AUTHORIZED = "Not authorized.";
export const TRANSCODE_RETRY_SUBMIT_FAILED =
  "Could not submit the proxy job. Please try again.";
export const TRANSCODE_RETRY_RECORD_FAILED =
  "Proxy job was submitted but could not be recorded. Do not retry yet; contact engineering.";
export const TRANSCODE_RETRY_CONFLICT =
  "A proxy job for this master is already in progress or complete.";

export const TRANSCODE_STATUS_LABELS: Record<TranscodeStatus, string> = {
  submitted: "Submitted",
  running: "Running",
  complete: "Complete",
  failed: "Failed",
  submit_failed: "Submit failed",
};

/** Only `failed` and `submit_failed` may be retried. Never submitted / running / complete. */
export function isTranscodeJobRetryable(status: TranscodeStatus): boolean {
  return (TRANSCODE_RETRYABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * True only when the error identifies the expected-output-key partial unique index
 * `transcode_jobs_active_key_uidx`. Other 23505 / uniqueness failures (e.g. external_job_id)
 * must NOT use the proxy-key conflict copy — they are record failures after AWS submit.
 */
export function isTranscodeJobUniqueConflict(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}): boolean {
  const haystack = [error.message, error.details, error.hint]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n");
  return haystack.includes("transcode_jobs_active_key_uidx");
}

/**
 * An active job is stuck when its `created_at` is strictly older than the threshold.
 * Matches the poll: `created_at.getTime() < now - 60m`. Exact equality is not stuck.
 * Invalid / unparseable timestamps fail closed (not stuck) — never invent a stuck signal
 * from garbage data.
 */
export function isTranscodeJobStuck(
  status: TranscodeStatus,
  createdAt: string,
  nowMs: number = Date.now(),
): boolean {
  if (!TRANSCODE_ACTIVE_STATUSES.includes(status)) return false;
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return false;
  return createdMs < nowMs - TRANSCODE_STUCK_THRESHOLD_MS;
}

/** Status label, with ` · Stuck` appended when the derived stuck state applies. */
export function formatTranscodeStatusLabel(
  status: TranscodeStatus,
  createdAt: string,
  nowMs: number = Date.now(),
): string {
  const base = TRANSCODE_STATUS_LABELS[status];
  return isTranscodeJobStuck(status, createdAt, nowMs)
    ? `${base} · ${TRANSCODE_STUCK_MARKER}`
    : base;
}

export function formatFailureReason(reason: string | null | undefined): string {
  if (reason == null || reason.trim() === "") return "—";
  return reason;
}

/** Screener filename when present; otherwise the short asset id; absent → em dash. */
export function formatOutputAsset(
  originalFilename: string | null | undefined,
  outputAssetId: string | null | undefined,
): string {
  if (outputAssetId == null || outputAssetId === "") return "—";
  const name = originalFilename?.trim();
  if (name) return name;
  return outputAssetId.slice(0, 8);
}

/**
 * Created-time display. Valid timestamps use the GC convention (`toLocaleString()`);
 * invalid / unparseable values fail closed to an em dash — never surface `Invalid Date`.
 */
export function formatTranscodeCreatedAt(createdAt: string): string {
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return "—";
  return new Date(createdMs).toLocaleString();
}
