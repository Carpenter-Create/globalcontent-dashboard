import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/mediaconvert", () => ({ submitProxyJob: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actionsSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "actions.ts"),
  "utf8",
);

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { submitProxyJob } from "@/lib/mediaconvert";
import { revalidatePath } from "next/cache";
import {
  TRANSCODE_RETRY_CONFLICT,
  TRANSCODE_RETRY_INELIGIBLE,
  TRANSCODE_RETRY_NOT_AUTHORIZED,
  TRANSCODE_RETRY_RECORD_FAILED,
  TRANSCODE_RETRY_SUBMIT_FAILED,
  TRANSCODE_RETRY_UNAUTHENTICATED,
} from "@/lib/transcode-jobs";

import { retryTranscodeJob } from "./actions";

const USER = { id: "gc-ops-1", email: "ops@globalcontent.co", name: null };
const TITLE_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const JOB_ID = "33333333-3333-3333-3333-333333333333";
const SOURCE_ASSET_ID = "44444444-4444-4444-4444-444444444444";
const MASTER_KEY = `orgs/${ORG_ID}/titles/${TITLE_ID}/master/${SOURCE_ASSET_ID}/film.mov`;
const EXPECTED_KEY = `orgs/${ORG_ID}/titles/${TITLE_ID}/screener/${SOURCE_ASSET_ID}/film.mp4`;

type JobRow = {
  id: string;
  org_id: string;
  title_id: string;
  source_asset_id: string;
  status: string;
};

type AssetRow = {
  id: string;
  storage_key: string;
  kind: string;
  org_id: string;
  title_id: string;
};

function maybeSingleQuery<T>(row: T | null, error: { message: string; code?: string } | null = null) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => ({ data: row, error }));
  return builder;
}

function fakeSupabase(opts: {
  job?: JobRow | null;
  jobError?: { message: string } | null;
  asset?: AssetRow | null;
  assetError?: { message: string } | null;
  canOperate?: boolean;
  canOperateError?: { message: string } | null;
  rpcError?: { message: string; code?: string; details?: string; hint?: string } | null;
  rpcReject?: Error;
}) {
  const jobBuilder = maybeSingleQuery(opts.job ?? null, opts.jobError ?? null);
  const assetBuilder = maybeSingleQuery(opts.asset ?? null, opts.assetError ?? null);
  const from = vi.fn((table: string) => {
    if (table === "transcode_jobs") return jobBuilder;
    if (table === "assets") return assetBuilder;
    throw new Error(`fakeSupabase: unexpected table "${table}"`);
  });
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "gc_can") {
      if (opts.canOperateError) return { data: null, error: opts.canOperateError };
      return { data: opts.canOperate ?? true, error: null };
    }
    if (fn === "create_transcode_job") {
      if (opts.rpcReject) throw opts.rpcReject;
      return opts.rpcError
        ? { data: null, error: opts.rpcError }
        : { data: "new-job-id", error: null };
    }
    throw new Error(`fakeSupabase: unexpected rpc "${fn}"`);
  });
  return { from, rpc, _jobBuilder: jobBuilder, _assetBuilder: assetBuilder };
}

const FAILED_JOB: JobRow = {
  id: JOB_ID,
  org_id: ORG_ID,
  title_id: TITLE_ID,
  source_asset_id: SOURCE_ASSET_ID,
  status: "failed",
};

const MASTER_ASSET: AssetRow = {
  id: SOURCE_ASSET_ID,
  storage_key: MASTER_KEY,
  kind: "master",
  org_id: ORG_ID,
  title_id: TITLE_ID,
};

function mountOperateClient(opts: Parameters<typeof fakeSupabase>[0] = {}) {
  const supabase = fakeSupabase({
    job: FAILED_JOB,
    asset: MASTER_ASSET,
    canOperate: true,
    ...opts,
  });
  vi.mocked(createClient).mockResolvedValue(
    supabase as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return supabase;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthUser).mockResolvedValue(USER);
  vi.mocked(submitProxyJob).mockResolvedValue({
    externalJobId: "aws-retry-1",
    expectedKey: EXPECTED_KEY,
  });
});

describe("retryTranscodeJob — authorization", () => {
  it("unauthenticated: returns approved copy and never submits or records", async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const supabase = mountOperateClient();

    const res = await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

    expect(res).toEqual({ error: TRANSCODE_RETRY_UNAUTHENTICATED });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(submitProxyJob).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("authenticated non-operate: Not authorized. before AWS and before create_transcode_job", async () => {
    const supabase = mountOperateClient({ canOperate: false });

    const res = await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

    expect(res).toEqual({ error: TRANSCODE_RETRY_NOT_AUTHORIZED });
    expect(supabase.rpc).toHaveBeenCalledWith("gc_can", {
      p_uid: USER.id,
      p_capability: "operate",
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(submitProxyJob).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalledWith("create_transcode_job", expect.anything());
  });

  it("gc_can lookup error: fails closed with no AWS submission", async () => {
    const supabase = mountOperateClient({
      canOperateError: { message: "rpc unavailable" },
    });

    const res = await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

    expect(res).toEqual({ error: TRANSCODE_RETRY_NOT_AUTHORIZED });
    expect(submitProxyJob).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalledWith("create_transcode_job", expect.anything());
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("RPC Not authorized after AWS: surfaces the identifiable RPC message", async () => {
    mountOperateClient({
      rpcError: { message: "Not authorized" },
    });

    const res = await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

    expect(res).toEqual({ error: "Not authorized." });
    expect(submitProxyJob).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("retryTranscodeJob — eligibility", () => {
  it.each(["submitted", "running", "complete"] as const)(
    "%s is not retryable — never submits",
    async (status) => {
      const supabase = mountOperateClient({
        job: { ...FAILED_JOB, status },
      });

      const res = await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

      expect(res).toEqual({ error: TRANSCODE_RETRY_INELIGIBLE });
      expect(submitProxyJob).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalledWith("create_transcode_job", expect.anything());
    },
  );

  it("missing job / title mismatch is ineligible", async () => {
    mountOperateClient({ job: null });

    const res = await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

    expect(res).toEqual({ error: TRANSCODE_RETRY_INELIGIBLE });
    expect(submitProxyJob).not.toHaveBeenCalled();
  });

  it("non-master source asset is ineligible — never submits", async () => {
    mountOperateClient({
      asset: { ...MASTER_ASSET, kind: "screener" },
    });

    const res = await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

    expect(res).toEqual({ error: TRANSCODE_RETRY_INELIGIBLE });
    expect(submitProxyJob).not.toHaveBeenCalled();
  });

  it.each(["failed", "submit_failed"] as const)(
    "%s is eligible and proceeds to submit",
    async (status) => {
      mountOperateClient({ job: { ...FAILED_JOB, status } });

      const res = await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

      expect(res).toEqual({});
      expect(submitProxyJob).toHaveBeenCalledTimes(1);
    },
  );
});

describe("retryTranscodeJob — source of truth + sequence", () => {
  it("uses server-read job org/title/source and asset storage_key — never client keys", async () => {
    const supabase = mountOperateClient();

    await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

    expect(submitProxyJob).toHaveBeenCalledWith({ masterKey: MASTER_KEY });
    expect(supabase.rpc).toHaveBeenCalledWith("create_transcode_job", {
      p_org_id: ORG_ID,
      p_title_id: TITLE_ID,
      p_source_asset_id: SOURCE_ASSET_ID,
      p_expected_output_key: EXPECTED_KEY,
      p_external_job_id: "aws-retry-1",
    });
    expect(supabase._jobBuilder.eq).toHaveBeenCalledWith("id", JOB_ID);
    expect(supabase._jobBuilder.eq).toHaveBeenCalledWith("title_id", TITLE_ID);
  });

  it("AWS submit failure: approved copy, never records", async () => {
    const supabase = mountOperateClient();
    vi.mocked(submitProxyJob).mockRejectedValue(new Error("MediaConvert down"));

    const res = await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

    expect(res).toEqual({ error: TRANSCODE_RETRY_SUBMIT_FAILED });
    expect(supabase.rpc).not.toHaveBeenCalledWith("create_transcode_job", expect.anything());
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("RPC returned error after AWS: split-brain copy, no revalidate", async () => {
    mountOperateClient({
      rpcError: { message: "connection reset mid-insert" },
    });

    const res = await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

    expect(res).toEqual({ error: TRANSCODE_RETRY_RECORD_FAILED });
    expect(submitProxyJob).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("RPC thrown/rejected after AWS: returns split-brain copy, does not throw", async () => {
    mountOperateClient({
      rpcReject: new Error("connection reset mid-call"),
    });

    await expect(
      retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID }),
    ).resolves.toEqual({ error: TRANSCODE_RETRY_RECORD_FAILED });
    expect(submitProxyJob).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("empty RPC message after AWS: split-brain warning, not Not authorized.", async () => {
    mountOperateClient({
      rpcError: { message: "" },
    });

    const res = await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

    expect(res).toEqual({ error: TRANSCODE_RETRY_RECORD_FAILED });
    expect(res.error).not.toBe(TRANSCODE_RETRY_NOT_AUTHORIZED);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("transcode_jobs_active_key_uidx conflict: approved conflict copy", async () => {
    mountOperateClient({
      rpcError: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "transcode_jobs_active_key_uidx"',
      },
    });

    const res = await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

    expect(res).toEqual({ error: TRANSCODE_RETRY_CONFLICT });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("unrelated 23505 (e.g. external_job_id): record-failure warning", async () => {
    mountOperateClient({
      rpcError: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "transcode_jobs_external_job_id_key"',
      },
    });

    const res = await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

    expect(res).toEqual({ error: TRANSCODE_RETRY_RECORD_FAILED });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves history: never updates/deletes the old job; creates via RPC only", async () => {
    const supabase = mountOperateClient();

    await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

    expect(supabase.from).toHaveBeenCalledWith("transcode_jobs");
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_transcode_job",
      expect.objectContaining({
        p_source_asset_id: SOURCE_ASSET_ID,
        p_external_job_id: "aws-retry-1",
      }),
    );
    const retryFn = actionsSrc.slice(actionsSrc.indexOf("export async function retryTranscodeJob"));
    expect(retryFn).not.toMatch(/\.update\(/);
    expect(retryFn).not.toMatch(/\.delete\(/);
    expect(retryFn).toContain('rpc("create_transcode_job"');
    expect(retryFn).toContain('rpc("gc_can"');
  });

  it("success: gc_can → submit → record → revalidate; submit before record", async () => {
    const supabase = mountOperateClient();

    const res = await retryTranscodeJob({ titleId: TITLE_ID, jobId: JOB_ID });

    expect(res).toEqual({});
    const gcIdx = supabase.rpc.mock.calls.findIndex((c) => c[0] === "gc_can");
    const createIdx = supabase.rpc.mock.calls.findIndex((c) => c[0] === "create_transcode_job");
    expect(gcIdx).toBeGreaterThanOrEqual(0);
    expect(createIdx).toBeGreaterThanOrEqual(0);
    const gcOrder = supabase.rpc.mock.invocationCallOrder[gcIdx];
    const createOrder = supabase.rpc.mock.invocationCallOrder[createIdx];
    const submitOrder = vi.mocked(submitProxyJob).mock.invocationCallOrder[0];
    expect(gcOrder).toBeLessThan(submitOrder);
    expect(submitOrder).toBeLessThan(createOrder);
    expect(revalidatePath).toHaveBeenCalledWith(`/gc/titles/${TITLE_ID}`);
  });
});
