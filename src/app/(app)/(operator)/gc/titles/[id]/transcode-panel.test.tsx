import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TRANSCODE_PANEL_EMPTY,
  TRANSCODE_PANEL_HEADING,
  TRANSCODE_RETRY_LABEL,
  TRANSCODE_RETRY_PENDING,
  TRANSCODE_RETRY_RECORD_FAILED,
  TRANSCODE_STUCK_MARKER,
  TRANSCODE_STUCK_THRESHOLD_MS,
} from "@/lib/transcode-jobs";

import {
  TranscodePanel,
  runTranscodeRetry,
  type TranscodeJobRow,
} from "./transcode-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("./actions", () => ({
  retryTranscodeJob: vi.fn(),
}));

const NOW = Date.parse("2026-08-07T18:00:00.000Z");
const TITLE_ID = "title-1";
const panelSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "transcode-panel.tsx"),
  "utf8",
);

function isoRelative(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function render(jobs: TranscodeJobRow[], canRetry = false): string {
  return renderToStaticMarkup(
    createElement(TranscodePanel, { titleId: TITLE_ID, jobs, canRetry }),
  );
}

function job(partial: Partial<TranscodeJobRow> & Pick<TranscodeJobRow, "id" | "status">): TranscodeJobRow {
  return {
    created_at: isoRelative(-1_000),
    failure_reason: null,
    output_asset_id: null,
    output_filename: null,
    ...partial,
  };
}

describe("TranscodePanel render", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("empty state shows the approved heading and empty copy", () => {
    const html = render([]);
    expect(html).toContain(TRANSCODE_PANEL_HEADING);
    expect(html).toContain(TRANSCODE_PANEL_EMPTY);
  });

  it("submitted + stuck row shows status, Stuck marker, and created time", () => {
    const created = isoRelative(-(TRANSCODE_STUCK_THRESHOLD_MS + 1));
    const html = render([
      job({
        id: "stuck-1",
        status: "submitted",
        created_at: created,
      }),
    ]);
    expect(html).toContain("Submitted");
    expect(html).toContain(TRANSCODE_STUCK_MARKER);
    expect(html).toContain(new Date(created).toLocaleString());
    expect(html).not.toContain(TRANSCODE_PANEL_EMPTY);
  });

  it("complete row shows the output filename", () => {
    const html = render([
      job({
        id: "complete-1",
        status: "complete",
        output_asset_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        output_filename: "client-title-screener.mp4",
      }),
    ]);
    expect(html).toContain("Complete");
    expect(html).toContain("client-title-screener.mp4");
  });

  it("failed row shows the failure reason in full", () => {
    const reason =
      "ERROR: MediaConvert failed with a long AWS diagnostic that must remain readable in the panel";
    const html = render([
      job({
        id: "failed-1",
        status: "failed",
        failure_reason: reason,
      }),
    ]);
    expect(html).toContain("Failed");
    expect(html).toContain(reason);
  });

  it("invalid created_at renders an em dash, never Invalid Date", () => {
    const html = render([
      job({
        id: "bad-time",
        status: "running",
        created_at: "not-a-timestamp",
      }),
    ]);
    expect(html).toContain("—");
    expect(html).not.toMatch(/Invalid Date/i);
  });

  it("long failure and filename cells stay wrap-capable (min-w-0 + break classes)", () => {
    // Mutation target: stripping these classes must fail this test.
    expect(panelSrc).toMatch(/min-w-0 flex-1 break-words/);
    expect(panelSrc).toMatch(/min-w-0 max-w-\[50%] shrink break-all/);
  });
});

describe("TranscodePanel Retry affordance (Task 6B)", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows Retry only when canRetry and status is failed/submit_failed", () => {
    expect(
      render([job({ id: "f1", status: "failed" })], true),
    ).toContain(TRANSCODE_RETRY_LABEL);
    expect(
      render([job({ id: "sf1", status: "submit_failed" })], true),
    ).toContain(TRANSCODE_RETRY_LABEL);
  });

  it("hides Retry when canRetry is false, even for failed jobs", () => {
    expect(
      render([job({ id: "f1", status: "failed" })], false),
    ).not.toContain(TRANSCODE_RETRY_LABEL);
  });

  it.each(["submitted", "running", "complete"] as const)(
    "hides Retry for %s even when canRetry",
    (status) => {
      expect(
        render([job({ id: status, status })], true),
      ).not.toContain(TRANSCODE_RETRY_LABEL);
    },
  );

  it("gates the button on canRetry && isTranscodeJobRetryable (mutation-check)", () => {
    expect(panelSrc).toContain("canRetry && isTranscodeJobRetryable(job.status)");
    expect(panelSrc).toContain("runTranscodeRetry");
    expect(panelSrc).toContain("disabled={pending}");
    expect(panelSrc).toContain("TRANSCODE_RETRY_PENDING");
  });
});

describe("runTranscodeRetry interaction (Task 6B)", () => {
  // Vitest runs in node (no jsdom). The button wires this helper; these tests prove
  // the click interaction contract: pending, disabled affordance inputs, error, refresh.

  it("failure path: invokes action, pending while in flight, shows error, no refresh", async () => {
    const pendingSeq: boolean[] = [];
    const errors: string[] = [];
    const refresh = vi.fn();
    let release!: (v: { error: string }) => void;
    const retry = vi.fn(
      () =>
        new Promise<{ error?: string }>((resolve) => {
          release = resolve;
        }),
    );

    const done = runTranscodeRetry({
      titleId: TITLE_ID,
      jobId: "failed-1",
      setPending: (p) => pendingSeq.push(p),
      setError: (e) => errors.push(e),
      refresh,
      retry,
    });

    expect(retry).toHaveBeenCalledWith({ titleId: TITLE_ID, jobId: "failed-1" });
    expect(pendingSeq).toEqual([true]);
    expect(errors).toEqual([""]);

    release({ error: "This job cannot be retried." });
    await done;

    expect(errors).toContain("This job cannot be retried.");
    expect(pendingSeq.at(-1)).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("success path: invokes action, refreshes, clears pending, no error", async () => {
    const pendingSeq: boolean[] = [];
    const errors: string[] = [];
    const refresh = vi.fn();
    const retry = vi.fn(async () => ({}));

    await runTranscodeRetry({
      titleId: TITLE_ID,
      jobId: "failed-1",
      setPending: (p) => pendingSeq.push(p),
      setError: (e) => errors.push(e),
      refresh,
      retry,
    });

    expect(retry).toHaveBeenCalledTimes(1);
    expect(pendingSeq).toEqual([true, false]);
    expect(errors).toEqual([""]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("rejected action promise: clears pending and surfaces split-brain copy (no stuck UI)", async () => {
    const pendingSeq: boolean[] = [];
    const errors: string[] = [];
    const refresh = vi.fn();
    const retry = vi.fn(async () => {
      throw new Error("unexpected reject");
    });

    await runTranscodeRetry({
      titleId: TITLE_ID,
      jobId: "failed-1",
      setPending: (p) => pendingSeq.push(p),
      setError: (e) => errors.push(e),
      refresh,
      retry,
    });

    expect(pendingSeq.at(-1)).toBe(false);
    expect(errors).toContain(TRANSCODE_RETRY_RECORD_FAILED);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("pending label constant remains the approved Retrying… copy", () => {
    expect(TRANSCODE_RETRY_PENDING).toBe("Retrying…");
  });
});
