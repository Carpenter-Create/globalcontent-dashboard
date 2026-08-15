import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DETAIL_LIST } from "@/lib/list-bounds";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import GcTitleDetail from "./page";
import { GcAssets } from "./gc-assets";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("unexpected notFound");
  }),
  redirect: vi.fn(() => {
    throw new Error("unexpected redirect");
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ getAuthUser: vi.fn() }));

// Keep the page's data orchestration and GcAssets production path real. Unrelated child
// panels are inert here so this test fails only on title-page asset wiring regressions.
vi.mock("@/components/findings/findings-card", () => ({ FindingsCard: () => null }));
vi.mock("./release-date-control", () => ({ ReleaseDateControl: () => null }));
vi.mock("@/app/(app)/(operator)/gc/review/review-controls", () => ({
  ReviewControls: () => null,
}));
vi.mock("@/app/(app)/(operator)/gc/review/link-controls", () => ({
  LinkControls: () => null,
}));
vi.mock("@/app/(app)/(operator)/gc/review/screener-panel", () => ({
  ScreenerPanel: () => null,
}));
vi.mock("./buyer-links", () => ({ BuyerLinks: () => null }));
vi.mock("./transcode-panel", () => ({ TranscodePanel: () => null }));

// Spy on the production export while retaining its real implementation and markup.
vi.mock("./gc-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gc-assets")>();
  return { ...actual, GcAssets: vi.fn(actual.GcAssets) };
});

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

  it("gates Retry via gc_can(operate) and never calls submit/record from the page", () => {
    // Retry mutation lives in actions.ts; the page only resolves the UI capability flag.
    expect(pageSrc).toContain('rpc("gc_can"');
    expect(pageSrc).toContain("canRetry={canOperate === true}");
    expect(pageSrc).not.toContain("create_transcode_job");
    expect(pageSrc).not.toContain("submitProxyJob");
    expect(pageSrc).not.toContain("retryTranscodeJob");
    expect(pageSrc).not.toContain('from("./actions")');
  });
});

type QueryResult = { data: unknown; error: null };

class QueryStub {
  readonly select = vi.fn(() => this);
  readonly eq = vi.fn(() => this);
  readonly is = vi.fn(() => this);
  readonly order = vi.fn(() => this);
  readonly maybeSingle = vi.fn(async (): Promise<QueryResult> => this.result);
  readonly limit = vi.fn(() => {
    if (this.boundsProhibited) throw new Error("assets query must not call limit");
    return this;
  });
  readonly range = vi.fn(() => {
    if (this.boundsProhibited) throw new Error("assets query must not call range");
    return this;
  });

  constructor(
    readonly data: unknown,
    private readonly boundsProhibited = false,
  ) {}

  private get result(): QueryResult {
    return { data: this.data, error: null };
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

describe("GcTitleDetail GcAssets wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders every title-scoped asset through the real unbounded GcAssets path", async () => {
    const titleId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const assets = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "master",
        original_filename: "north-star-master.mov",
        bytes: 2048,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        kind: "caption",
        original_filename: "north-star-en.vtt",
        bytes: 512,
      },
    ];
    const queries: Record<string, QueryStub> = {
      titles: new QueryStub({
        id: titleId,
        title: "North Star",
        catalog_id: "GC-0000001",
        status: "submitted",
        work_id: null,
        created_at: "2026-08-14T00:00:00.000Z",
        release_type: "new_release",
        original_release_date: null,
        release_date: null,
        organizations: { name: "Example Org" },
      }),
      rights_grants: new QueryStub([]),
      portal_links: new QueryStub([]),
      title_metadata: new QueryStub({ data: {} }),
      findings: new QueryStub([]),
      assets: new QueryStub(assets, true),
      deliveries: new QueryStub([]),
      vendors: new QueryStub([]),
      transcode_jobs: new QueryStub([]),
    };
    const from = vi.fn((table: string) => {
      const query = queries[table];
      if (!query) throw new Error(`unexpected table: ${table}`);
      return query;
    });
    const rpc = vi.fn((name: string) => {
      const data = name === "gc_can" ? true : [];
      return Promise.resolve({ data, error: null });
    });

    vi.mocked(createClient).mockResolvedValue(
      { from, rpc } as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    vi.mocked(getAuthUser).mockResolvedValue({ id: "staff-user", email: "staff@example.com" });

    const page = await GcTitleDetail({ params: Promise.resolve({ id: titleId }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("north-star-master.mov");
    expect(html).toContain("north-star-en.vtt");
    expect(html.match(/View \/ download/g)).toHaveLength(2);
    expect(vi.mocked(GcAssets)).toHaveBeenCalled();
    expect(vi.mocked(GcAssets).mock.calls.map(([props]) => props.assets)).toContainEqual(assets);
    expect(queries.assets.eq).toHaveBeenCalledWith("title_id", titleId);
    expect(queries.assets.limit).not.toHaveBeenCalled();
    expect(queries.assets.range).not.toHaveBeenCalled();
  });
});
