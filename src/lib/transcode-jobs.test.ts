import { describe, expect, it } from "vitest";

import {
  TRANSCODE_PANEL_EMPTY,
  TRANSCODE_PANEL_HEADING,
  TRANSCODE_RETRY_CONFLICT,
  TRANSCODE_RETRY_INELIGIBLE,
  TRANSCODE_RETRY_LABEL,
  TRANSCODE_RETRY_NOT_AUTHORIZED,
  TRANSCODE_RETRY_PENDING,
  TRANSCODE_RETRY_RECORD_FAILED,
  TRANSCODE_RETRY_SUBMIT_FAILED,
  TRANSCODE_RETRY_UNAUTHENTICATED,
  TRANSCODE_STUCK_THRESHOLD_MS,
  formatFailureReason,
  formatOutputAsset,
  formatTranscodeCreatedAt,
  formatTranscodeStatusLabel,
  isTranscodeJobRetryable,
  isTranscodeJobStuck,
  isTranscodeJobUniqueConflict,
  TRANSCODE_STATUS_LABELS,
  type TranscodeStatus,
} from "./transcode-jobs";

const NOW = Date.parse("2026-08-07T18:00:00.000Z");

function isoRelative(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

describe("isTranscodeJobStuck", () => {
  it.each<[TranscodeStatus]>([["submitted"], ["running"]])(
    "%s under the 60-minute threshold is not stuck",
    (status) => {
      expect(isTranscodeJobStuck(status, isoRelative(-30 * 60 * 1000), NOW)).toBe(false);
    },
  );

  it.each<[TranscodeStatus]>([["submitted"], ["running"]])(
    "%s older than 60 minutes is stuck",
    (status) => {
      expect(isTranscodeJobStuck(status, isoRelative(-(60 * 60 * 1000 + 1)), NOW)).toBe(true);
    },
  );

  it("exact 60-minute boundary is not stuck (strictly older than)", () => {
    // Poll uses `created_at < stuckCutoff`. Equality must stay green.
    expect(isTranscodeJobStuck("running", isoRelative(-TRANSCODE_STUCK_THRESHOLD_MS), NOW)).toBe(
      false,
    );
  });

  it.each<[TranscodeStatus]>([["complete"], ["failed"], ["submit_failed"]])(
    "terminal status %s is never stuck, even when old",
    (status) => {
      expect(isTranscodeJobStuck(status, isoRelative(-(3 * 60 * 60 * 1000)), NOW)).toBe(false);
    },
  );

  it("malformed created_at fails safely (not stuck)", () => {
    expect(isTranscodeJobStuck("running", "not-a-timestamp", NOW)).toBe(false);
    expect(isTranscodeJobStuck("submitted", "", NOW)).toBe(false);
  });
});

describe("formatTranscodeStatusLabel", () => {
  it.each(
    (Object.entries(TRANSCODE_STATUS_LABELS) as [TranscodeStatus, string][]).map(
      ([status, label]) => [status, label] as const,
    ),
  )("renders canonical label for %s", (status, label) => {
    expect(formatTranscodeStatusLabel(status, isoRelative(-1_000), NOW)).toBe(label);
  });

  it("appends Stuck only for an over-threshold active job", () => {
    expect(
      formatTranscodeStatusLabel("running", isoRelative(-(60 * 60 * 1000 + 1)), NOW),
    ).toBe("Running · Stuck");
    expect(
      formatTranscodeStatusLabel("submitted", isoRelative(-(60 * 60 * 1000 + 1)), NOW),
    ).toBe("Submitted · Stuck");
    expect(
      formatTranscodeStatusLabel("failed", isoRelative(-(60 * 60 * 1000 + 1)), NOW),
    ).toBe("Failed");
  });
});

describe("formatFailureReason", () => {
  it("returns the reason when present", () => {
    expect(formatFailureReason("MediaConvert ERROR")).toBe("MediaConvert ERROR");
  });

  it("returns an em dash when missing or blank", () => {
    expect(formatFailureReason(null)).toBe("—");
    expect(formatFailureReason(undefined)).toBe("—");
    expect(formatFailureReason("")).toBe("—");
    expect(formatFailureReason("   ")).toBe("—");
  });
});

describe("formatOutputAsset", () => {
  const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

  it("prefers the screener filename when present", () => {
    expect(formatOutputAsset("title-screener.mp4", id)).toBe("title-screener.mp4");
  });

  it("falls back to a short asset id when filename is missing", () => {
    expect(formatOutputAsset(null, id)).toBe("a1b2c3d4");
    expect(formatOutputAsset("", id)).toBe("a1b2c3d4");
    expect(formatOutputAsset("   ", id)).toBe("a1b2c3d4");
  });

  it("returns an em dash when there is no output asset", () => {
    expect(formatOutputAsset("title-screener.mp4", null)).toBe("—");
    expect(formatOutputAsset(null, null)).toBe("—");
    expect(formatOutputAsset(null, "")).toBe("—");
  });
});

describe("formatTranscodeCreatedAt", () => {
  it("formats a valid timestamp with toLocaleString", () => {
    const iso = "2026-08-07T18:00:00.000Z";
    expect(formatTranscodeCreatedAt(iso)).toBe(new Date(iso).toLocaleString());
  });

  it("returns an em dash for invalid timestamps — never Invalid Date", () => {
    expect(formatTranscodeCreatedAt("not-a-timestamp")).toBe("—");
    expect(formatTranscodeCreatedAt("")).toBe("—");
    expect(formatTranscodeCreatedAt("not-a-timestamp")).not.toMatch(/Invalid Date/i);
  });
});

describe("approved panel copy", () => {
  it("exports the founder-approved heading and empty state verbatim", () => {
    expect(TRANSCODE_PANEL_HEADING).toBe("Proxy jobs");
    expect(TRANSCODE_PANEL_EMPTY).toBe("No proxy jobs.");
  });
});

describe("isTranscodeJobRetryable", () => {
  it.each<[TranscodeStatus]>([["failed"], ["submit_failed"]])(
    "%s is retryable",
    (status) => {
      expect(isTranscodeJobRetryable(status)).toBe(true);
    },
  );

  it.each<[TranscodeStatus]>([["submitted"], ["running"], ["complete"]])(
    "%s is never retryable",
    (status) => {
      expect(isTranscodeJobRetryable(status)).toBe(false);
    },
  );
});

describe("isTranscodeJobUniqueConflict", () => {
  it("is true only when the error names transcode_jobs_active_key_uidx", () => {
    expect(
      isTranscodeJobUniqueConflict({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "transcode_jobs_active_key_uidx"',
      }),
    ).toBe(true);
    expect(
      isTranscodeJobUniqueConflict({
        details: "Key (expected_output_key)=(...) already exists.",
        message: "transcode_jobs_active_key_uidx",
      }),
    ).toBe(true);
  });

  it("does not treat bare 23505 or unrelated uniqueness as the proxy-key conflict", () => {
    expect(isTranscodeJobUniqueConflict({ code: "23505", message: "duplicate key" })).toBe(
      false,
    );
    expect(
      isTranscodeJobUniqueConflict({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "transcode_jobs_external_job_id_key"',
      }),
    ).toBe(false);
    expect(
      isTranscodeJobUniqueConflict({
        message: "unique constraint violated",
      }),
    ).toBe(false);
    expect(isTranscodeJobUniqueConflict({ message: "Not authorized" })).toBe(false);
  });
});

describe("approved retry copy (Task 6B)", () => {
  it("exports founder-approved strings verbatim", () => {
    expect(TRANSCODE_RETRY_LABEL).toBe("Retry");
    expect(TRANSCODE_RETRY_PENDING).toBe("Retrying…");
    expect(TRANSCODE_RETRY_UNAUTHENTICATED).toBe("Not authenticated.");
    expect(TRANSCODE_RETRY_INELIGIBLE).toBe("This job cannot be retried.");
    expect(TRANSCODE_RETRY_NOT_AUTHORIZED).toBe("Not authorized.");
    expect(TRANSCODE_RETRY_SUBMIT_FAILED).toBe(
      "Could not submit the proxy job. Please try again.",
    );
    expect(TRANSCODE_RETRY_RECORD_FAILED).toBe(
      "Proxy job was submitted but could not be recorded. Do not retry yet; contact engineering.",
    );
    expect(TRANSCODE_RETRY_CONFLICT).toBe(
      "A proxy job for this master is already in progress or complete.",
    );
  });
});
