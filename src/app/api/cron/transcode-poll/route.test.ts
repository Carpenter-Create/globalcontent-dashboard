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
import { GET } from "./route";

const SECRET = "test-cron-secret-value";

type Job = { id: string; external_job_id: string | null; expected_output_key: string; created_at: string };
type RpcResult = { data: unknown; error: { message: string } | null };

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

// A chainable stand-in for the PostgREST query builder — select/in/order/range all
// pass through, and awaiting the builder (the route's `await ... .range(from, to)`) resolves
// to { data: jobs, error: null }, mirroring the fakeQuery pattern in actions.test.ts.
function fakeSupabase(jobs: Job[], rpcImpl?: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "in", "order"]) builder[method] = vi.fn(() => builder);
  builder.range = vi.fn(() => builder);
  builder.then = (
    resolve: (v: { data: Job[]; error: null }) => void,
    reject: (e: unknown) => void,
  ) => Promise.resolve({ data: jobs, error: null }).then(resolve, reject);

  const from = vi.fn((table: string) => {
    if (table === "transcode_jobs") return builder;
    throw new Error(`fakeSupabase: unexpected table "${table}"`);
  });
  const rpc = vi.fn(rpcImpl ?? (async () => ({ data: null, error: null })));
  return { from, rpc };
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
  it("selects only submitted/running jobs, bounded", async () => {
    const supabase = fakeSupabase([]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);

    await GET(req({ Authorization: `Bearer ${SECRET}` }));

    expect(supabase.from).toHaveBeenCalledWith("transcode_jobs");
  });

  it("a COMPLETE job with the object present registers with the job's OWN recorded key", async () => {
    const j = job({ id: "job-complete", expected_output_key: "orgs/o/titles/t/screener/u/x_screener.mp4" });
    const rpc = vi.fn(async (fn: string) => ({
      data: fn === "register_transcode_output" ? "asset-1" : null,
      error: null,
    }));
    const supabase = fakeSupabase([j], rpc);
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
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const supabase = fakeSupabase([j], rpc);
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

  it("an ERROR job fails via fail_transcode_job with AWS's own reason", async () => {
    const j = job({ id: "job-error" });
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const supabase = fakeSupabase([j], rpc);
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
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const supabase = fakeSupabase([j], rpc);
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
    const rpc = vi.fn(async (fn: string) => ({
      data: fn === "register_transcode_output" ? "asset-fine" : null,
      error: null,
    }));
    const supabase = fakeSupabase([j1, j2], rpc);
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
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const supabase = fakeSupabase([j], rpc);
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

  it("a job resolved 'already complete' by a concurrent run is a no-op, not an error", async () => {
    const j = job({ id: "job-race" });
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "fail_transcode_job") return { data: null, error: { message: "Job not found or already complete" } };
      return { data: null, error: null };
    });
    const supabase = fakeSupabase([j], rpc);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);
    vi.mocked(getJob).mockResolvedValue({ status: "ERROR", errorMessage: "stale event" });

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { alreadyResolved: number; errored: number; failed: number };

    expect(json.alreadyResolved).toBe(1);
    expect(json.errored).toBe(0);
    expect(json.failed).toBe(0);
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

  it("an old still-open job contributes to the stuck count and a fresh one does not", async () => {
    const old = job({
      id: "job-old",
      external_job_id: null,
      created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const fresh = job({ id: "job-fresh", external_job_id: null, created_at: new Date().toISOString() });
    const supabase = fakeSupabase([old, fresh]);
    vi.mocked(createAdminClient).mockReturnValue(supabase as unknown as ReturnType<typeof createAdminClient>);

    const res = await GET(req({ Authorization: `Bearer ${SECRET}` }));
    const json = (await res.json()) as { stuck: number };

    expect(json.stuck).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[transcode:stuck] 1 job"));
  });
});
