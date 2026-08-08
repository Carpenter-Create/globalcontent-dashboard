import {
  TRANSCODE_PANEL_EMPTY,
  TRANSCODE_PANEL_HEADING,
  formatFailureReason,
  formatOutputAsset,
  formatTranscodeCreatedAt,
  formatTranscodeStatusLabel,
  type TranscodeStatus,
} from "@/lib/transcode-jobs";

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
 * Read-only GC visibility for screener-proxy jobs on a title (Task 6A).
 * Stuck state is derived from status + created_at — no heartbeat table.
 * Retry (Task 6B) is intentionally absent.
 */
export function TranscodePanel({ jobs }: { jobs: TranscodeJobRow[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="t-label text-ink-3">{TRANSCODE_PANEL_HEADING}</span>
      {jobs.length === 0 ? (
        <span className="t-body-sm text-ink-3">{TRANSCODE_PANEL_EMPTY}</span>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          {jobs.map((job) => (
            <div key={job.id} className="flex min-w-0 flex-col gap-0.5 t-body-sm">
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
