import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TRANSCODE_PANEL_EMPTY,
  TRANSCODE_PANEL_HEADING,
  TRANSCODE_STUCK_MARKER,
  TRANSCODE_STUCK_THRESHOLD_MS,
} from "@/lib/transcode-jobs";

import { TranscodePanel, type TranscodeJobRow } from "./transcode-panel";

const NOW = Date.parse("2026-08-07T18:00:00.000Z");
const panelSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "transcode-panel.tsx"),
  "utf8",
);

function isoRelative(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function render(jobs: TranscodeJobRow[]): string {
  return renderToStaticMarkup(createElement(TranscodePanel, { jobs }));
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
