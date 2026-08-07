import { describe, expect, it } from "vitest";
import { buildExportFilename, slugSegment } from "@/lib/export-filename";

const base = { catalogId: "GC00417", title: "Monarch: Legacy of Monsters", date: new Date("2026-08-06T12:00:00Z") };

describe("buildExportFilename", () => {
  it("orders catalog id, title, date, recipient", () => {
    expect(buildExportFilename({ ...base, recipient: "Tubi" }))
      .toBe("GC00417_monarch-legacy-of-monsters_2026-08-06_tubi.xlsx");
  });

  it("falls back to global_content when there is no recipient", () => {
    expect(buildExportFilename({ ...base, recipient: null }))
      .toBe("GC00417_monarch-legacy-of-monsters_2026-08-06_global_content.xlsx");
  });
});

describe("slugSegment — untrusted input reaches a Content-Disposition header", () => {
  it("strips path separators", () => {
    expect(slugSegment("../../etc/passwd", "fallback")).toBe("etc-passwd");
  });

  it("strips CRLF so a header cannot be split", () => {
    expect(slugSegment("Tubi\r\nX-Evil: 1", "fallback")).toBe("tubi-x-evil-1");
  });

  it("strips quotes", () => {
    expect(slugSegment('Tubi"; rm -rf /', "fallback")).toBe("tubi-rm-rf");
  });

  it("caps length at 60", () => {
    expect(slugSegment("a".repeat(200), "fallback")).toHaveLength(60);
  });

  it("falls back when nothing usable survives", () => {
    expect(slugSegment("///", "global_content")).toBe("global_content");
    expect(slugSegment("", "global_content")).toBe("global_content");
    expect(slugSegment(null, "global_content")).toBe("global_content");
  });
});
