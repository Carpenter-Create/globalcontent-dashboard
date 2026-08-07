import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Same local-mock pattern as src/app/(app)/titles/[id]/actions.test.ts and
// src/app/api/assets/complete/route.test.ts: the smallest fake that covers what this route
// actually calls, built local to this file rather than shared test infra.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/mediaconvert", () => ({ getJob: vi.fn() }));
vi.mock("@/lib/s3", () => ({ headObjectMeta: vi.fn() }));

import { createAdminClient } from "@/lib/supabase/admin";
import { getJob } from "@/lib/mediaconvert";
import { headObjectMeta } from "@/lib/s3";
import { probeRange, UNPAGINATED_MAX } from "@/lib/list-bounds";
import { GET, rotate } from "./route";

const SECRET = "test-cron-secret-value";

type Job = { id: string; external_job_id: string | null; expected_output_key: string; created_at: string };
type RpcResult = { data: unknown; error: { message: string } | null };
type RpcImpl = (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;

function req(headers: Record<string, string> = {}) {
  return new Request("http://test/api/cron/transcode-poll", { headers });
}

function job(overrides: Partial<Job> = {}): Job {
  // Spread, not `??`-per-field: `??` treats an explicitly-passed `null` (e.g.
  // `external_job_id: null`) as "unset" and falls back to the default, silently defeating any
  // fixture that means to test the no-external-id path. Spread copies exactly what the caller
  // passed, including an explicit null.
  return {
    id: "job-1",
    external_job_id: "aws-job-1",
    expected_output_key: "orgs/org-1/titles/title-1/screener/u/x_screener.mp4",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// A chainable stand-in for the PostgREST query builder. `from("transcode_jobs")` is called
// once for the bulk in-flight read AND, per terminal-outcome job, once more by the route's
// `alreadyTerminal` peek (`select("status").eq("id", ...).maybeSingle()`) — so this returns a
// FRESH builder per call (tracked in `builders`, in call order) rather than one shared object,
// and that builder answers whichever of the two shapes is used against it.
//
// `peekStatuses` controls what `alreadyTerminal` sees for a given job id — defaulting to
// "submitted" (still active) for any id not listed, so every existing fixture that doesn't
// care about the peek behaves as if no concurrent run touched it.
function fakeSupabase(
  jobs: Job[],
  opts: { rpcImpl?: RpcImpl; peekStatuses?: Record<string, string> } = {},
) {
  const peekStatuses = opts.peekStatuses ?? {};
  const builders: Record<string, unknown>[] = [];

  const from = vi.fn((table: string) => {
    if (table !== "transcode_jobs") throw new Error(`fakeSupabase: unexpected table "${table}"`);
    const builder: Record<string, unknown> = {};
    let eqId: string | undefined;
    for (const method of ["select", "in", "order"]) builder[method] = vi.fn(() => builder);
    builder.range = vi.fn(() => builder);
    builder.eq = vi.fn((col: string, val: string) => {
      if (col === "id") eqId = val;
      return builder;
    });
    builder.maybeSingle = vi.fn(async () => ({
      data: { status: eqId !== undefined ? (peekStatuses[eqId] ?? "submitted") : null },
      error: null,
    }));
    builder.then = (
      resolve: (v: { data: Job[]; error: null }) => void,
      reject: (e: unknown) => void,
    ) => Promise.resolve({ data: jobs, error: null }).then(resolve, reject);
    builders.push(builder);
    return builder;
  });

  const rpc = vi.fn(opts.rpcImpl ?? (async () => ({ data: null, error: null })));
  return { from, rpc, builders };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.restoreAllMocks();
});

// Fix round 3, item 4: rotate() previously had zero coverage and wasn't even exported —
// removing the call to it left all 276 tests green. Exported and tested directly now.
describe("rotate", () => {
  it("returns the array unchanged when empty", () => {
    expect(rotate([], 12345)).toEqual([]);
  });

  it("returns a single-item array unchanged regardless of `now`", () => {
    expect(rotate(["a"], 0)).toEqual(["a"]);
    expect(rotate(["a"], 999_999_999)).toEqual(["a"]);
  });

  it("rotates by an offset derived from the tick epoch", () => {
    const items = ["a", "b", "c", "d", "e"];
    const tickMs = 5 * 60 * 1000;
    // epoch 0 -> offset 0 -> unchanged
    expect(rotate(items, 0)).toEqual(["a", "b", "c", "d", "e"]);
    // epoch 1 -> offset 1 % 5 = 1
    expect(rotate(items, tickMs)).toEqual(["b", "c", "d", "e", "a"]);
    // epoch 2 -> offset 2 % 5 = 2
    expect(rotate(items, tickMs * 2)).toEqual(["c", "d", "e", "a", "b"]);
  });

  it("wraps around when the epoch exceeds the array length — no job is permanently stuck at the tail", () => {
    const items = ["a", "b", "c"];
    const tickMs = 5 * 60 * 1000;
    // epoch 5 -> offset 5 % 3 = 2
    expect(rotate(items, tickMs * 5)).toEqual(["c", "a", "b"]);
    // Different ticks produce different orderings — this IS the fix: a persistently-bad
    // head-of-queue item is not "first" on every tick.
    const firstItems = new Set([0, 1, 2, 3, 4].map((epoch) => rotate(items, tickMs * epoch)[0]));
    expect(firstItems.size).toBeGreaterThan(1);
  });

  it("does not mutate the input array", () => {
    const items = ["a", "b", "c"];
    const copy = [...items];
    rotate(items, 5 * 60 * 1000);
    expect(items).toEqual(copy);
  });
});

describe("GET /api/cron/transcode-poll — authentication", () => {
  it("no Authorization header refuses and calls nothing", async () => {
    const supabase = fakeSupabase([]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(getJob).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("wrong secret refuses and calls nothing", async () => {
    const supabase = fakeSupabase([]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);

    const res = await GET(req({ Authorization: "Bearer not-the-right-secret" }));

    expect(res.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(getJob).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("unset CRON_SECRET refuses even with a header present — never fails open", async () => {
    delete process.env.CRON_SECRET;
    const supabase = fakeSupabase([]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));

    expect(res.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/transcode-poll — job resolution", () => {
  // Fix round 1, item 4: the previous version of this test asserted only
  // `from` was called with "transcode_jobs" — true even against a route that dropped the
  // status filter or the range bound entirely, since the fake builder returns itself from
  // every method regardless of what's actually called. Pin the REAL calls instead.
  it("selects only submitted/running jobs, bounded via list-bounds", async () => {
    const supabase = fakeSupabase([]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);

    await GET(req({ Authorization: `Bearer ${SECRET}` }));

    expect(supabase.from).toHaveBeenCalledWith("transcode_jobs");
    const [bulkBuilder] = supabase.builders; // the only from() call when there are zero jobs
    expect(bulkBuilder.in).toHaveBeenCalledWith("status", ["submitted", "running"]);
    const [from, to] = probeRange(UNPAGINATED_MAX);
    expect(bulkBuilder.range).toHaveBeenCalledWith(from, to);
  });

  it("a COMPLETE job with the object present registers with the job's OWN recorded key", async () => {
    const j = job({ id: "job-complete", expected_output_key: "orgs/o/titles/t/screener/u/x_screener.mp4" });
    const rpc: RpcImpl = async (fn) => ({
      data: fn === "register_transcode_output" ? "asset-1" : null,
      error: null,
    });
    const supabase = fakeSupabase([j], { rpcImpl: rpc });
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockResolvedValue({ status: "COMPLETE", errorMessage: null });
    vi.mocked(headObjectMeta).mockResolvedValue({ bytes: 12345, etag: "abc123" });

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { completed: number };

    expect(res.status).toBe(200);
    expect(headObjectMeta).toHaveBeenCalledWith(j.expected_output_key);
    expect(supabase.rpc).toHaveBeenCalledWith("register_transcode_output", {
      p_job_id: "job-complete",
      p_storage_key: j.expected_output_key,
      p_bytes: 12345,
      p_content_hash: "abc123",
    });
    expect(json.completed).toBe(1);
  });

  it("a COMPLETE job with the object missing fails the job and registers nothing", async () => {
    const j = job({ id: "job-missing-object" });
    const supabase = fakeSupabase([j]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockResolvedValue({ status: "COMPLETE", errorMessage: null });
    vi.mocked(headObjectMeta).mockResolvedValue(null);

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { failed: number };

    expect(res.status).toBe(200);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "fail_transcode_job",
      expect.objectContaining({ p_job_id: "job-missing-object" }),
    );
    expect(supabase.rpc).not.toHaveBeenCalledWith("register_transcode_output", expect.anything());
    expect(json.failed).toBe(1);
  });

  // Fix round 1, item 7: a 0-byte object is not a viewable screener and must be treated the
  // same as an absent one, not registered.
  it("a COMPLETE job whose object is 0 bytes fails the job and registers nothing", async () => {
    const j = job({ id: "job-zero-bytes" });
    const supabase = fakeSupabase([j]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockResolvedValue({ status: "COMPLETE", errorMessage: null });
    vi.mocked(headObjectMeta).mockResolvedValue({ bytes: 0, etag: "empty" });

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { failed: number };

    expect(supabase.rpc).toHaveBeenCalledWith(
      "fail_transcode_job",
      expect.objectContaining({ p_job_id: "job-zero-bytes", p_reason: expect.stringContaining("0 bytes") }),
    );
    expect(supabase.rpc).not.toHaveBeenCalledWith("register_transcode_output", expect.anything());
    expect(json.failed).toBe(1);
  });

  it("an ERROR job fails via fail_transcode_job with AWS's own reason", async () => {
    const j = job({ id: "job-error" });
    const supabase = fakeSupabase([j]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockResolvedValue({ status: "ERROR", errorMessage: "codec unsupported" });

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { failed: number };

    expect(supabase.rpc).toHaveBeenCalledWith("fail_transcode_job", {
      p_job_id: "job-error",
      p_reason: "codec unsupported",
    });
    expect(headObjectMeta).not.toHaveBeenCalled();
    expect(json.failed).toBe(1);
  });

  it("a CANCELED job also fails via fail_transcode_job", async () => {
    const j = job({ id: "job-canceled" });
    const supabase = fakeSupabase([j]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockResolvedValue({ status: "CANCELED", errorMessage: null });

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { failed: number };

    expect(supabase.rpc).toHaveBeenCalledWith(
      "fail_transcode_job",
      expect.objectContaining({ p_job_id: "job-canceled" }),
    );
    expect(json.failed).toBe(1);
  });

  it("a still-running job is left alone", async () => {
    const j = job({ id: "job-progressing" });
    const supabase = fakeSupabase([j]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockResolvedValue({ status: "PROGRESSING", errorMessage: null });

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { stillRunning: number };

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(json.stillRunning).toBe(1);
  });

  it("one job throwing does not stop the others", async () => {
    const j1 = job({ id: "job-throws", external_job_id: "aws-throws" });
    const j2 = job({
      id: "job-fine",
      external_job_id: "aws-fine",
      expected_output_key: "orgs/o/titles/t/screener/u2/y_screener.mp4",
    });
    const rpc: RpcImpl = async (fn) => ({
      data: fn === "register_transcode_output" ? "asset-fine" : null,
      error: null,
    });
    const supabase = fakeSupabase([j1, j2], { rpcImpl: rpc });
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockImplementation(async (id: string) => {
      if (id === "aws-throws") throw new Error("network blip");
      return { status: "COMPLETE", errorMessage: null };
    });
    vi.mocked(headObjectMeta).mockResolvedValue({ bytes: 1, etag: "e" });

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { errored: number; completed: number };

    expect(json.errored).toBe(1);
    expect(json.completed).toBe(1);
    expect(supabase.rpc).toHaveBeenCalledWith(
      "register_transcode_output",
      expect.objectContaining({ p_job_id: "job-fine" }),
    );
  });

  it("a HeadObject failure that is not 'confirmed absent' does not fail the job (AWS-errored, not transcode-failed)", async () => {
    const j = job({ id: "job-head-throws" });
    const supabase = fakeSupabase([j]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockResolvedValue({ status: "COMPLETE", errorMessage: null });
    vi.mocked(headObjectMeta).mockRejectedValue(new Error("S3 throttled"));

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { errored: number; failed: number };

    expect(supabase.rpc).not.toHaveBeenCalledWith("fail_transcode_job", expect.anything());
    expect(supabase.rpc).not.toHaveBeenCalledWith("register_transcode_output", expect.anything());
    expect(json.errored).toBe(1);
    expect(json.failed).toBe(0);
  });

  // Fix round 1, items 5/7: replaced the old regex-on-error-text detection (which could not
  // tell "already complete" apart from "not found" — the RPC raises the identical message for
  // both) with a peek at the row's actual current status immediately before writing. A
  // concurrent run that already completed the job is now detected BEFORE fail_transcode_job
  // is even called, not inferred from its error afterwards.
  it("a job a concurrent run already completed is a no-op, not an error — and fail_transcode_job is never called", async () => {
    const j = job({ id: "job-race-fail" });
    const supabase = fakeSupabase([j], { peekStatuses: { "job-race-fail": "complete" } });
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockResolvedValue({ status: "ERROR", errorMessage: "stale event" });

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { alreadyResolved: number; errored: number; failed: number };

    expect(json.alreadyResolved).toBe(1);
    expect(json.errored).toBe(0);
    expect(json.failed).toBe(0);
    expect(supabase.rpc).not.toHaveBeenCalledWith("fail_transcode_job", expect.anything());
  });

  // The equivalent gap on the register path per the review: an overlapping run's idempotent
  // return used to be silently counted as `completed`, inflating the count with a
  // registration that didn't actually happen this tick.
  //
  // Fix round 2, item 1 restructured the route into phases so the fleet-wide corroboration
  // gate can see EVERY complete job's object-check result before any of them are written —
  // which means the peek now only happens at write time (performWrite), not before the
  // object check. headObjectMeta IS called here (a cost accepted for the correctness the
  // phase split buys); the safety property that matters — register_transcode_output is never
  // called for an already-resolved job — still holds via the write-time peek.
  it("a job a concurrent run already completed on the COMPLETE path is a no-op — register_transcode_output is never called", async () => {
    const j = job({ id: "job-race-complete" });
    const supabase = fakeSupabase([j], { peekStatuses: { "job-race-complete": "complete" } });
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockResolvedValue({ status: "COMPLETE", errorMessage: null });
    vi.mocked(headObjectMeta).mockResolvedValue({ bytes: 123, etag: "e" });

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { alreadyResolved: number; completed: number };

    expect(json.alreadyResolved).toBe(1);
    expect(json.completed).toBe(0);
    expect(supabase.rpc).not.toHaveBeenCalledWith("register_transcode_output", expect.anything());
  });

  it("truncates the selection at the list-bounds ceiling and logs a warning", async () => {
    const jobs = Array.from({ length: 501 }, (_, i) => job({ id: `job-${i}`, external_job_id: null }));
    const supabase = fakeSupabase(jobs);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { truncated: boolean; checked: number };

    expect(json.truncated).toBe(true);
    expect(json.checked).toBe(500);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("truncated"));
  });

  // Fix round 1, item 7: the previous fixtures used `external_job_id: null` for both jobs —
  // a state no real "stuck in MediaConvert" job can be in (that shape means the SUBMIT itself
  // never got an id back, not that a real job is taking a long time). Real fixtures: both have
  // an external id, MediaConvert genuinely reports a non-terminal status, and the route
  // actually calls GetJob for each.
  it("an old still-open job contributes to the stuck count and a fresh one does not", async () => {
    const old = job({
      id: "job-old",
      external_job_id: "aws-old",
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const fresh = job({ id: "job-fresh", external_job_id: "aws-fresh", created_at: new Date().toISOString() });
    const supabase = fakeSupabase([old, fresh]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockResolvedValue({ status: "PROGRESSING", errorMessage: null });

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { stuck: number; stillRunning: number };

    expect(getJob).toHaveBeenCalledWith("aws-old");
    expect(getJob).toHaveBeenCalledWith("aws-fresh");
    expect(json.stillRunning).toBe(2);
    expect(json.stuck).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[transcode:stuck] 1 job"));
  });

  // Fix round 1, item 5: the one thing Vercel itself surfaces (the invocation's HTTP status)
  // must not stay green through a total AWS outage. Fix round 2, item 4 added
  // TOTAL_FAILURE_FLOOR (3) so this only fires on a real sample, not a single blip — this
  // fixture uses 3 jobs specifically to clear that floor.
  it("returns a non-200 when every job in a non-empty run of at least the failure floor errored", async () => {
    const jobs = [
      job({ id: "job-outage-1", external_job_id: "aws-1" }),
      job({ id: "job-outage-2", external_job_id: "aws-2" }),
      job({ id: "job-outage-3", external_job_id: "aws-3" }),
    ];
    const supabase = fakeSupabase(jobs);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockRejectedValue(new Error("MediaConvert unreachable"));

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { errored: number };

    expect(json.errored).toBe(3);
    expect(res.status).not.toBe(200);
  });

  // Fix round 2, item 4 — the hair-trigger this floor exists to fix: below the floor, a
  // transient blip on the only job (or one of only two) in flight must not trip the same
  // alarm a genuine total outage does. The error is still counted and still visible in the
  // JSON body — just not escalated to the one signal Vercel itself surfaces.
  it("stays 200 when fewer than the failure floor are in flight, even if all of them errored", async () => {
    const jobs = [
      job({ id: "job-small-1", external_job_id: "aws-1" }),
      job({ id: "job-small-2", external_job_id: "aws-2" }),
    ];
    const supabase = fakeSupabase(jobs);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockRejectedValue(new Error("transient blip"));

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { errored: number };

    expect(json.errored).toBe(2);
    expect(res.status).toBe(200);
  });

  it("stays 200 when jobs are a healthy mix, even if one errored", async () => {
    const ok = job({ id: "job-ok", external_job_id: "aws-ok" });
    const bad = job({ id: "job-bad", external_job_id: "aws-bad" });
    const supabase = fakeSupabase([ok, bad]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockImplementation(async (id: string) => {
      if (id === "aws-bad") throw new Error("transient");
      return { status: "PROGRESSING", errorMessage: null };
    });

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { errored: number; stillRunning: number };

    expect(json.errored).toBe(1);
    expect(json.stillRunning).toBe(1);
    expect(res.status).toBe(200);
  });

  describe("fleet-wide corroboration gate (fix round 2, item 1)", () => {
    // The core case the gate exists for: granting s3:ListBucket turned a missing object into
    // a CONFIRMED absence, and fail_transcode_job is permanent. If every COMPLETE job this
    // tick reports its output missing, that looks like a configuration fault, not N
    // independent failures — none of them may be permanently failed on that basis.
    it("more than one COMPLETE job, ALL missing: none are failed, held back, and the response is non-200", async () => {
      const jobs = [
        job({ id: "job-sys-1", external_job_id: "aws-1", expected_output_key: "orgs/o/titles/t/screener/u1/a.mp4" }),
        job({ id: "job-sys-2", external_job_id: "aws-2", expected_output_key: "orgs/o/titles/t/screener/u2/b.mp4" }),
        job({ id: "job-sys-3", external_job_id: "aws-3", expected_output_key: "orgs/o/titles/t/screener/u3/c.mp4" }),
      ];
      const supabase = fakeSupabase(jobs);
      vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
      vi.mocked(getJob).mockResolvedValue({ status: "COMPLETE", errorMessage: null });
      vi.mocked(headObjectMeta).mockResolvedValue(null); // every single one reports missing

      const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
      const json = (await res.json()) as { held: number; failed: number; completed: number };

      expect(json.held).toBe(3);
      expect(json.failed).toBe(0);
      expect(json.completed).toBe(0);
      expect(supabase.rpc).not.toHaveBeenCalledWith("fail_transcode_job", expect.anything());
      expect(res.status).not.toBe(200);
    });

    // The other half of the same walk: if SOME of the complete jobs this tick found their
    // object fine, the missing one(s) are NOT systemic — a sibling in the same tick proves
    // the pipeline/bucket/permissions are working, so a genuinely individual failure is not
    // suppressed.
    it("more than one COMPLETE job, SOME missing: the missing ones still fail normally, the present ones still register", async () => {
      const present = job({ id: "job-mix-present", external_job_id: "aws-present", expected_output_key: "orgs/o/titles/t/screener/u1/a.mp4" });
      const missing = job({ id: "job-mix-missing", external_job_id: "aws-missing", expected_output_key: "orgs/o/titles/t/screener/u2/b.mp4" });
      const rpc: RpcImpl = async (fn) => ({ data: fn === "register_transcode_output" ? "asset-1" : null, error: null });
      const supabase = fakeSupabase([present, missing], { rpcImpl: rpc });
      vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
      vi.mocked(getJob).mockResolvedValue({ status: "COMPLETE", errorMessage: null });
      vi.mocked(headObjectMeta).mockImplementation(async (key: string) =>
        key.includes("u1") ? { bytes: 100, etag: "e" } : null,
      );

      const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
      const json = (await res.json()) as { held: number; failed: number; completed: number };

      expect(json.held).toBe(0);
      expect(json.failed).toBe(1);
      expect(json.completed).toBe(1);
      expect(supabase.rpc).toHaveBeenCalledWith(
        "fail_transcode_job",
        expect.objectContaining({ p_job_id: "job-mix-missing" }),
      );
      expect(res.status).toBe(200);
    });

    // Fleet size of exactly one: nothing to corroborate against, so a single complete-but-
    // missing job must still fail normally, exactly as it did before this fix round.
    it("exactly ONE COMPLETE job missing: fails normally, not held (fleet size 1 has nothing to corroborate against)", async () => {
      const j = job({ id: "job-solo-missing" });
      const supabase = fakeSupabase([j]);
      vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
      vi.mocked(getJob).mockResolvedValue({ status: "COMPLETE", errorMessage: null });
      vi.mocked(headObjectMeta).mockResolvedValue(null);

      const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
      const json = (await res.json()) as { held: number; failed: number };

      expect(json.held).toBe(0);
      expect(json.failed).toBe(1);
      expect(supabase.rpc).toHaveBeenCalledWith(
        "fail_transcode_job",
        expect.objectContaining({ p_job_id: "job-solo-missing" }),
      );
    });

    // Fix round 3, item 3: a 0-byte object PROVES the bucket is reachable and the key is
    // exactly right — it is evidence AGAINST a configuration fault, not for one. Folding it
    // into "missing" (fix round 2) meant two genuine 0-byte encodes in one tick could trip the
    // gate and hold both forever. They must never be held, individually or as a group.
    it("multiple 0-byte objects in the same tick are never held — each fails normally, unconditionally", async () => {
      const jobs = [
        job({ id: "job-empty-1", external_job_id: "aws-1", expected_output_key: "orgs/o/titles/t/screener/u1/a.mp4" }),
        job({ id: "job-empty-2", external_job_id: "aws-2", expected_output_key: "orgs/o/titles/t/screener/u2/b.mp4" }),
      ];
      const supabase = fakeSupabase(jobs);
      vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
      vi.mocked(getJob).mockResolvedValue({ status: "COMPLETE", errorMessage: null });
      vi.mocked(headObjectMeta).mockResolvedValue({ bytes: 0, etag: "empty" }); // BOTH are 0 bytes

      const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
      const json = (await res.json()) as { held: number; failed: number };

      expect(json.held).toBe(0);
      expect(json.failed).toBe(2);
      expect(supabase.rpc).toHaveBeenCalledWith(
        "fail_transcode_job",
        expect.objectContaining({ p_job_id: "job-empty-1", p_reason: expect.stringContaining("0 bytes") }),
      );
      expect(supabase.rpc).toHaveBeenCalledWith(
        "fail_transcode_job",
        expect.objectContaining({ p_job_id: "job-empty-2", p_reason: expect.stringContaining("0 bytes") }),
      );
    });

    // Fix round 3, item 2 — the coupling the review found: the OLD gate only fired when
    // `completeTotal > 1`, so a CHECKED cohort of exactly one (whether that's the true fleet
    // size, or an artifact of phase C1 being truncated mid-tick) always fell through to "fail
    // normally," indistinguishably. This is a PERMANENT regression test for the fix that does
    // NOT depend on tuning CONCURRENCY down to reproduce (see the task report for the literal
    // CONCURRENCY=1 mutation-check, done separately by hand): 11 COMPLETE jobs, the first 10 of
    // which fit in ONE batch and get checked (9 present, 1 absent), the 11th deferred by the
    // time budget before ever being checked. Under the pre-fix gate, 9 present results would
    // have looked like strong evidence against a systemic fault, and the 1 absent job would
    // have failed normally. The fix holds it anyway: with the 11th job never checked, this
    // tick's cohort cannot be trusted as the whole picture.
    it("an absent result is held when phase C1 itself was truncated, even alongside mostly-present siblings", async () => {
      const checkedJobs = Array.from({ length: 10 }, (_, i) =>
        job({
          id: i === 0 ? "job-truncated-absent" : `job-truncated-present-${i}`,
          external_job_id: `aws-${i}`,
          expected_output_key: `orgs/o/titles/t/screener/u${i}/f.mp4`,
        }),
      );
      const deferredJob = job({ id: "job-truncated-deferred", external_job_id: "aws-deferred" });
      const allJobs = [...checkedJobs, deferredJob];

      const supabase = fakeSupabase(allJobs);
      vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
      vi.mocked(getJob).mockResolvedValue({ status: "COMPLETE", errorMessage: null });
      vi.mocked(headObjectMeta).mockImplementation(async (key: string) =>
        key.includes("u0") ? null : { bytes: 100, etag: "e" },
      );

      // `now = 0` deliberately: rotate()'s epoch is `floor(now / TICK_INTERVAL_MS) % length`,
      // and a non-zero `now` would rotate WHICH job lands in which batch — this test needs
      // job-truncated-absent to land in the FIRST (checked) batch and job-truncated-deferred
      // in the SECOND (deferred) one, deterministically. `now = 0` gives epoch 0, offset 0,
      // i.e. no rotation, so the array order below is exactly the batch order.
      //
      // 11 items, CONCURRENCY 10: phase A batches at i=0 (10 items) and i=10 (1 item) — both
      // must clear checkDeadline so all 11 resolve to awsComplete. Phase C1 then batches the
      // same way: the first 10 (all of `checkedJobs`) clear checkDeadline and get HeadObject'd;
      // the 11th (`deferredJob`) does not.
      const base = 0;
      const nowSpy = vi.spyOn(Date, "now");
      nowSpy.mockReturnValueOnce(base); // now (deadline calc)
      nowSpy.mockReturnValueOnce(base); // phase A i=0 (10 items)
      nowSpy.mockReturnValueOnce(base); // phase A i=10 (1 item)
      nowSpy.mockReturnValueOnce(base); // phase C1 i=0 (10 items) — checked
      nowSpy.mockReturnValueOnce(base + 999_999); // phase C1 i=10 (1 item) — exceeded, deferred
      nowSpy.mockReturnValueOnce(base); // write phase i=0 (9 register tasks) — within writeDeadline
      nowSpy.mockReturnValue(base + 999_999); // stuckCutoff and anything else

      const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
      const json = (await res.json()) as { held: number; failed: number; completed: number };
      nowSpy.mockRestore();

      expect(json.held).toBe(1);
      expect(json.failed).toBe(0);
      expect(json.completed).toBe(9);
      expect(supabase.rpc).not.toHaveBeenCalledWith(
        "fail_transcode_job",
        expect.objectContaining({ p_job_id: "job-truncated-absent" }),
      );
    });
  });

  // Fix round 2, item 3: a hanging AWS call previously had no ceiling at all — the SDK
  // default is no request timeout. Forcing a GetJob call that never resolves proves the
  // application-level race actually bounds it, rather than relying solely on client
  // configuration this test can't directly observe.
  it("a GetJob call that never resolves is timed out rather than hanging the poll indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const j = job({ id: "job-hang", external_job_id: "aws-hang" });
      const supabase = fakeSupabase([j]);
      vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
      vi.mocked(getJob).mockReturnValue(new Promise(() => {})); // never settles

      const resPromise = GET(req({ Authorization: `Bearer ${SECRET}` }));
      await vi.advanceTimersByTimeAsync(15_000); // comfortably past the per-call ceiling
      const res = await resPromise;
      const json = (await res.json()) as { errored: number };

      expect(json.errored).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // Fix round 3, item 4: the SAME withTimeout race wraps headObjectMeta in checkObject, but
  // only the GetJob hang above was ever tested — removing the wrap around headObjectMeta left
  // all tests green. Prove it independently: a job that clears phase A (COMPLETE) but then
  // hangs forever on the S3 check must still resolve the poll, not hang it.
  it("a HeadObject call that never resolves is timed out rather than hanging the poll indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const j = job({ id: "job-head-hang", external_job_id: "aws-head-hang" });
      const supabase = fakeSupabase([j]);
      vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
      vi.mocked(getJob).mockResolvedValue({ status: "COMPLETE", errorMessage: null });
      vi.mocked(headObjectMeta).mockReturnValue(new Promise(() => {})); // never settles

      const resPromise = GET(req({ Authorization: `Bearer ${SECRET}` }));
      await vi.advanceTimersByTimeAsync(15_000); // comfortably past the per-call ceiling
      const res = await resPromise;
      const json = (await res.json()) as { errored: number; completed: number; failed: number };

      expect(json.errored).toBe(1);
      expect(json.completed).toBe(0);
      expect(json.failed).toBe(0);
      expect(supabase.rpc).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // Fix round 1, item 6: a serial loop with no deadline would run every selected job to
  // completion (or timeout) regardless of how long that takes. Forcing Date.now() past the
  // internal budget after the first batch proves the route stops itself and reports the
  // remainder as deferred, rather than either hanging or silently dropping them.
  it("defers jobs to the next tick once the internal time budget is exceeded", async () => {
    const jobs = Array.from({ length: 25 }, (_, i) => job({ id: `job-${i}`, external_job_id: null }));
    const supabase = fakeSupabase(jobs);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);

    const base = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(base); // the deadline computation
    nowSpy.mockReturnValueOnce(base); // first batch's budget check — not yet exceeded
    nowSpy.mockReturnValue(base + 999_999); // every check after: budget blown

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { checked: number; deferred: number; stillRunning: number };

    nowSpy.mockRestore();

    expect(json.checked).toBe(25);
    expect(json.deferred).toBeGreaterThan(0);
    expect(json.deferred).toBeLessThan(25);
    expect(json.deferred + json.stillRunning).toBe(25);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("time budget exceeded"));
  });

  describe("reserved write budget (fix round 3, item 1)", () => {
    // The bug: writes used to run on the SAME clock the checking phases had already spent.
    // 13 jobs: job-0 clears both checking phases while the check budget is still fresh, jobs
    // 1-9 are cheap no-op stillRunning jobs padding phase A's first batch to CONCURRENCY, and
    // jobs 10-12 are deferred out of phase A by a budget that (per this mock) is exhausted by
    // the time phase A reaches its SECOND batch. job-0's register write must still succeed —
    // it has its own reserved budget, not whatever's left of the checking phases' clock.
    it("a job resolved before the check budget ran out still gets written, even while other jobs in the same tick are deferred", async () => {
      const resolvedJob = job({
        id: "job-resolved",
        external_job_id: "aws-resolved",
        expected_output_key: "orgs/o/titles/t/screener/u0/f.mp4",
      });
      const padding = Array.from({ length: 9 }, (_, i) =>
        job({ id: `job-pad-${i}`, external_job_id: null }),
      );
      const deferredPadding = Array.from({ length: 3 }, (_, i) =>
        job({ id: `job-deferred-${i}`, external_job_id: null }),
      );
      const allJobs = [resolvedJob, ...padding, ...deferredPadding]; // 1 + 9 + 3 = 13

      const rpc: RpcImpl = async (fn) => ({ data: fn === "register_transcode_output" ? "asset-1" : null, error: null });
      const supabase = fakeSupabase(allJobs, { rpcImpl: rpc });
      vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
      vi.mocked(getJob).mockResolvedValue({ status: "COMPLETE", errorMessage: null });
      vi.mocked(headObjectMeta).mockResolvedValue({ bytes: 100, etag: "e" });

      // `now = 0` avoids rotate() reordering the array (see the corroboration-gate truncation
      // test above for why). Phase A batches at i=0 (10 items: job-resolved + 9 padding) and
      // i=10 (3 items: the deferred padding) — only the second check exceeds checkDeadline.
      // Phase C1 then only ever sees job-resolved (the only awsComplete job), well within
      // checkDeadline. The write phase's check uses a value PAST what checkDeadline would have
      // been (35s) but still under the separately-reserved writeDeadline (55s) — proving the
      // write is evaluated against its OWN clock, not a shared, already-spent one.
      const base = 0;
      const nowSpy = vi.spyOn(Date, "now");
      nowSpy.mockReturnValueOnce(base); // now
      nowSpy.mockReturnValueOnce(base); // phase A i=0 (10 items incl. job-resolved)
      nowSpy.mockReturnValueOnce(base + 40_000); // phase A i=10 (3 items) — past checkDeadline (35s)
      nowSpy.mockReturnValueOnce(base); // phase C1 i=0 (job-resolved only)
      nowSpy.mockReturnValueOnce(base + 40_000); // write phase i=0 — past 35s, still under writeDeadline (55s)
      nowSpy.mockReturnValue(base + 40_000); // stuckCutoff etc.

      const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
      const json = (await res.json()) as { completed: number; deferred: number; stillRunning: number };
      nowSpy.mockRestore();

      expect(json.completed).toBe(1);
      expect(json.deferred).toBe(3);
      expect(json.stillRunning).toBe(9);
      expect(supabase.rpc).toHaveBeenCalledWith(
        "register_transcode_output",
        expect.objectContaining({ p_job_id: "job-resolved" }),
      );
    });

    // The other half: if the write budget ITSELF is also exhausted (an extreme case — even the
    // reserved slice ran out), the route must never silently report 200 with nothing written.
    // This is the literal scenario the review's bug report described: writes deferred, status
    // green. massDeferral (fix round 3, item 1's second half) is what closes it.
    it("if even the reserved write budget is exhausted, the response is non-200 rather than a silent 200 with nothing written", async () => {
      const jobs = [
        job({ id: "job-w1", external_job_id: "aws-w1", expected_output_key: "orgs/o/titles/t/screener/u1/f.mp4" }),
        job({ id: "job-w2", external_job_id: "aws-w2", expected_output_key: "orgs/o/titles/t/screener/u2/f.mp4" }),
        job({ id: "job-w3", external_job_id: "aws-w3", expected_output_key: "orgs/o/titles/t/screener/u3/f.mp4" }),
        job({ id: "job-w4", external_job_id: "aws-w4", expected_output_key: "orgs/o/titles/t/screener/u4/f.mp4" }),
      ];
      const supabase = fakeSupabase(jobs);
      vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
      vi.mocked(getJob).mockResolvedValue({ status: "COMPLETE", errorMessage: null });
      vi.mocked(headObjectMeta).mockResolvedValue({ bytes: 100, etag: "e" });

      const base = 0;
      const nowSpy = vi.spyOn(Date, "now");
      nowSpy.mockReturnValueOnce(base); // now
      nowSpy.mockReturnValueOnce(base); // phase A i=0 (all 4 fit in one batch) — within checkDeadline
      nowSpy.mockReturnValueOnce(base); // phase C1 i=0 (all 4) — within checkDeadline
      nowSpy.mockReturnValueOnce(base + 60_000); // write phase i=0 — PAST writeDeadline (55s) too
      nowSpy.mockReturnValue(base + 60_000); // stuckCutoff etc.

      const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
      const json = (await res.json()) as { checked: number; deferred: number; completed: number };
      nowSpy.mockRestore();

      expect(json.checked).toBe(4);
      expect(json.deferred).toBe(4); // all 4 write tasks deferred
      expect(json.completed).toBe(0);
      expect(supabase.rpc).not.toHaveBeenCalledWith("register_transcode_output", expect.anything());
      expect(res.status).not.toBe(200);
    });
  });
});
