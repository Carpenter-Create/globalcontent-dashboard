import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DETAIL_LIST } from "@/lib/list-bounds";

const pageSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");

/**
 * Task 6A wiring constraints that are easy to "improve" away in a later edit:
 * the read must stay inside the existing Promise.all, stay title-scoped, and stay
 * bounded. These tests read the page source so removing `.eq("title_id", id)` or
 * hoisting the query out of Promise.all fails HERE — not silently at runtime.
 */
describe("GcTitleDetail transcode_jobs read (Task 6A)", () => {
  it("loads transcode_jobs inside the existing Promise.all", () => {
    const start = pageSrc.indexOf("await Promise.all([");
    expect(start).toBeGreaterThanOrEqual(0);
    // The Promise.all call ends at the matching `]);` that closes the array — take
    // a generous slice from the call through the next blank-line after its closer.
    const after = pageSrc.slice(start);
    const endRel = after.indexOf("]);\n");
    expect(endRel).toBeGreaterThan(0);
    const block = after.slice(0, endRel);
    expect(block).toContain('.from("transcode_jobs")');
    // Guard against a second, sequential await sneaking in beside the parallel block.
    expect(pageSrc.indexOf('.from("transcode_jobs")')).toBeGreaterThan(start);
    expect(pageSrc.indexOf('.from("transcode_jobs")')).toBeLessThan(start + endRel);
  });

  it("scopes the read to the current title and bounds it via list-bounds", () => {
    const start = pageSrc.indexOf('.from("transcode_jobs")');
    expect(start).toBeGreaterThanOrEqual(0);
    // Walk forward to the next semicolon-terminated statement end (the chained call).
    const chain = pageSrc.slice(start, pageSrc.indexOf(";", start) + 1);
    expect(chain).toContain('.eq("title_id", id)');
    expect(chain).toContain("range(...rangeFor(DETAIL_LIST))");
    // DETAIL_LIST is the repo's detail-page child-collection bound — pin the constant
    // so swapping in an unbounded .select() or a magic number fails this test.
    expect(DETAIL_LIST).toBe(200);
  });

  it("does not wire a retry mutation in this page (Task 6B is separate)", () => {
    // Comments may name Task 6B; the page must not call the submit/retry surfaces.
    expect(pageSrc).not.toContain("create_transcode_job");
    expect(pageSrc).not.toContain("submitTranscode");
    expect(pageSrc).not.toContain("retryTranscode");
    expect(pageSrc).not.toContain('from("./actions")');
  });
});
