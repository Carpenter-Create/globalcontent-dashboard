// Pure decision logic for the scheduled transcode poll (src/app/api/cron/transcode-poll).
// No AWS SDK import, no I/O — the route does the network calls and hands this module a
// plain status string, so the decision itself is unit-tested apart from MediaConvert/S3.

export type JobOutcome = "complete" | "failed" | null;

/**
 * Map a MediaConvert `GetJob` response's `Status` field to what the poll should do next.
 * `COMPLETE` → register the output. `ERROR`/`CANCELED` → fail the job. Anything else
 * (`PROGRESSING`, `SUBMITTED`, an unrecognised future status) → `null`, meaning "leave the
 * row alone, check again next tick." Unrecognised is deliberately treated the same as
 * non-terminal rather than as a third case: a status this mapper has never seen is not
 * evidence the transcode failed.
 */
export function resolveJobOutcome(status: string | undefined | null): JobOutcome {
  if (status === "COMPLETE") return "complete";
  if (status === "ERROR" || status === "CANCELED") return "failed";
  return null;
}
