import { describe, expect, it } from "vitest";

import { ASK_GLOBEE } from "@/lib/ask-globee";
import {
  askGlobeeAnswerText,
  askGlobeeDownloadFilename,
  askGlobeeOpenUserTurn,
  filterAskGlobeeHistory,
  formatAskGlobeeAttribution,
  formatAskGlobeeHistoryTime,
  groupAskGlobeeHistory,
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

describe("askGlobeeOpenUserTurn", () => {
  it("detects an unanswered user turn and ignores completed or blank ones", () => {
    expect(askGlobeeOpenUserTurn([])).toBeNull();
    expect(askGlobeeOpenUserTurn([{ role: "user", body: "What is blocking a title" }])).toBe(
      "What is blocking a title",
    );
    expect(
      askGlobeeOpenUserTurn([
        { role: "user", body: "What is blocking a title" },
        { role: "globee", body: "Harbor Cut is missing a synopsis." },
      ]),
    ).toBeNull();
    expect(askGlobeeOpenUserTurn([{ role: "user", body: "   " }])).toBeNull();
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

describe("groupAskGlobeeHistory", () => {
  it("partitions this week from older threads and filters by title", () => {
    const rows = [
      { id: "today", title: "What needs attention", updated_at: new Date(2026, 7, 19, 7, 10, 0).toISOString() },
      { id: "yesterday", title: "What is blocking a title", updated_at: new Date(2026, 7, 18, 7, 10, 0).toISOString() },
      { id: "older", title: "What should I submit next", updated_at: new Date(2026, 7, 1, 7, 10, 0).toISOString() },
    ];
    const grouped = groupAskGlobeeHistory(rows, NOW);
    expect(grouped.thisWeek.map((row) => row.id)).toEqual(["today", "yesterday"]);
    expect(grouped.allThreads.map((row) => row.id)).toEqual(["older"]);
    expect(filterAskGlobeeHistory(rows, "blocking").map((row) => row.id)).toEqual(["yesterday"]);
    expect(filterAskGlobeeHistory(rows, "   ").map((row) => row.id)).toEqual(["today", "yesterday", "older"]);
    expect(JSON.stringify(grouped)).not.toContain("Winter Line");
    expect(JSON.stringify(grouped)).not.toContain("Harbor Lights");
    expect(JSON.stringify(grouped)).not.toContain("Get support");
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
