"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import {
  TRANSCODE_PANEL_EMPTY,
  TRANSCODE_PANEL_HEADING,
  TRANSCODE_RETRY_LABEL,
  TRANSCODE_RETRY_PENDING,
  TRANSCODE_RETRY_RECORD_FAILED,
  formatFailureReason,
  formatOutputAsset,
  formatTranscodeCreatedAt,
  formatTranscodeStatusLabel,
  isTranscodeJobRetryable,
  type TranscodeStatus,
} from "@/lib/transcode-jobs";

import { retryTranscodeJob } from "./actions";

export type TranscodeJobRow = {
  id: string;
  status: TranscodeStatus;
  created_at: string;
  failure_reason: string | null;
  output_asset_id: string | null;
  /** Joined from assets via output_asset_id; null when incomplete or filename unset. */
  output_filename: string | null;
};

/**
 * Client Retry interaction state machine. Exported so tests can prove pending /
 * error / refresh behavior without adding a DOM test dependency (vitest runs in node).
 * The button wires this; pending disables ordinary repeat clicks on the same control.
 */
export async function runTranscodeRetry(input: {
  titleId: string;
  jobId: string;
  setPending: (pending: boolean) => void;
  setError: (error: string) => void;
  refresh: () => void;
  retry?: (args: { titleId: string; jobId: string }) => Promise<{ error?: string }>;
}): Promise<void> {
  const retry = input.retry ?? retryTranscodeJob;
  input.setPending(true);
  input.setError("");
  try {
    const res = await retry({ titleId: input.titleId, jobId: input.jobId });
    if (res?.error) {
      input.setError(res.error);
      return;
    }
    input.refresh();
  } catch {
    // Action should return `{ error }` rather than throw; if a promise rejects anyway,
    // clear pending and surface the split-brain copy rather than leave the control stuck.
    input.setError(TRANSCODE_RETRY_RECORD_FAILED);
  } finally {
    input.setPending(false);
  }
}

/**
 * GC visibility for screener-proxy jobs on a title.
 * Stuck state is derived from status + created_at — no heartbeat table.
 * Retry (Task 6B) only for failed / submit_failed when the viewer can operate.
 *
 * Note (non-blocking): the whole panel is a client component so Retry can hold
 * pending state. A server panel + client Retry island would be narrower; not
 * refactored in this correction pass.
 */
export function TranscodePanel({
  titleId,
  jobs,
  canRetry,
}: {
  titleId: string;
  jobs: TranscodeJobRow[];
  /** True when `gc_can(operate)` — UI hint only; the action re-checks eligibility + RPC gate. */
  canRetry: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="t-label text-ink-3">{TRANSCODE_PANEL_HEADING}</span>
      {jobs.length === 0 ? (
        <span className="t-body-sm text-ink-3">{TRANSCODE_PANEL_EMPTY}</span>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          {jobs.map((job) => (
            <TranscodeJobRowView
              key={job.id}
              titleId={titleId}
              job={job}
              canRetry={canRetry}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TranscodeJobRowView({
  titleId,
  job,
  canRetry,
}: {
  titleId: string;
  job: TranscodeJobRow;
  canRetry: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const showRetry = canRetry && isTranscodeJobRetryable(job.status);

  async function onRetry() {
    await runTranscodeRetry({
      titleId,
      jobId: job.id,
      setPending,
      setError,
      refresh: () => router.refresh(),
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5 t-body-sm">
      <div className="flex min-w-0 items-center justify-between gap-4">
        <span className="min-w-0 break-words text-ink-2">
          {formatTranscodeStatusLabel(job.status, job.created_at)}
        </span>
        <span className="shrink-0 text-ink-3">
          {formatTranscodeCreatedAt(job.created_at)}
        </span>
      </div>
      <div className="flex min-w-0 items-baseline justify-between gap-4">
        <span className="min-w-0 flex-1 break-words text-ink-3">
          {formatFailureReason(job.failure_reason)}
        </span>
        <span className="min-w-0 max-w-[50%] shrink break-all text-right text-ink-3">
          {formatOutputAsset(job.output_filename, job.output_asset_id)}
        </span>
      </div>
      {showRetry ? (
        <div className="flex min-w-0 flex-col items-start gap-1 pt-1">
          <Button
            type="button"
            variant="secondary"
            onClick={onRetry}
            disabled={pending}
          >
            {pending ? TRANSCODE_RETRY_PENDING : TRANSCODE_RETRY_LABEL}
          </Button>
          {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
        </div>
      ) : null}
    </div>
  );
}
