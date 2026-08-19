import { describe, expect, it } from "vitest";

import { ASK_GLOBEE } from "@/lib/ask-globee";
import {
  askGlobeeAnswerText,
  askGlobeeDownloadFilename,
  formatAskGlobeeAttribution,
  formatAskGlobeeHistoryTime,
  nextAskGlobeeThumb,
  sortAskGlobeeHistory,
} from "./ask-globee-conversations";

const NOW = new Date(2026, 7, 19, 15, 10, 0);

describe("sortAskGlobeeHistory", () => {
  it("pins first, then newest updated", () => {
    const rows = [
      { id: "c", pinned_at: null, updated_at: "2026-08-19T14:00:00.000Z" },
      { id: "a", pinned_at: "2026-08-18T10:00:00.000Z", updated_at: "2026-08-18T10:00:00.000Z" },
      { id: "b", pinned_at: "2026-08-19T09:00:00.000Z", updated_at: "2026-08-19T09:00:00.000Z" },
      { id: "d", pinned_at: null, updated_at: "2026-08-17T12:00:00.000Z" },
    ];
    expect(sortAskGlobeeHistory(rows).map((row) => row.id)).toEqual(["b", "a", "c", "d"]);
  });
});

describe("askGlobee answer chrome helpers", () => {
  it("copies lead and follow as one text block", () => {
    expect(askGlobeeAnswerText("Lead.", "Follow.")).toBe("Lead.\nFollow.");
    expect(askGlobeeAnswerText("Lead.", null)).toBe("Lead.");
  });

  it("names the download from the conversation title", () => {
    expect(askGlobeeDownloadFilename("What needs attention")).toBe("what-needs-attention.txt");
  });

  it("toggles the same thumb off and replaces the other", () => {
    expect(nextAskGlobeeThumb(null, "up")).toBe("up");
    expect(nextAskGlobeeThumb("up", "up")).toBeNull();
    expect(nextAskGlobeeThumb("up", "down")).toBe("down");
  });
});

describe("Ask Globee relative time", () => {
  it("uses clock, Yesterday, weekday, then a short date", () => {
    expect(formatAskGlobeeHistoryTime(new Date(2026, 7, 19, 7, 10, 0).toISOString(), NOW)).toMatch(
      /\d{1,2}:\d{2} [AP]M/,
    );
    expect(formatAskGlobeeHistoryTime(new Date(2026, 7, 18, 7, 10, 0).toISOString(), NOW)).toBe(
      "Yesterday",
    );
    expect(formatAskGlobeeHistoryTime(new Date(2026, 7, 16, 7, 10, 0).toISOString(), NOW)).toBe(
      "Sun",
    );
    expect(formatAskGlobeeHistoryTime(new Date(2026, 7, 1, 7, 10, 0).toISOString(), NOW)).toBe(
      "Aug 1",
    );
  });

  it("attributes Globee with clock time, never the Winter Line fixture", () => {
    const line = formatAskGlobeeAttribution("2026-08-19T11:10:00.000Z");
    expect(line.startsWith(`${ASK_GLOBEE.attributionName} · `)).toBe(true);
    expect(line).toMatch(/ · \d{1,2}:\d{2} [AP]M$/);
    expect(line).not.toBe(ASK_GLOBEE.attribution);
    expect(line).not.toContain("Winter Line");
  });
});
