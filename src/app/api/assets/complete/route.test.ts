import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Same mock shape as src/app/(app)/titles/[id]/actions.test.ts: the smallest fake that covers
// what this route actually calls — no shared test infra, per that file's own note that this
// repo builds these local to the test rather than as shared fixtures.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/assets", () => ({ resolveOperableTitle: vi.fn() }));
vi.mock("@/lib/s3", () => ({ completeMultipart: vi.fn() }));
vi.mock("@/lib/mediaconvert", () => ({ submitProxyJob: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { resolveOperableTitle } from "@/lib/assets";
import { completeMultipart } from "@/lib/s3";
import { submitProxyJob } from "@/lib/mediaconvert";
import { POST } from "./route";

const ORG_ID = "org-1";
const TITLE_ID = "11111111-1111-4111-8111-111111111111";
const MASTER_KEY = `orgs/${ORG_ID}/titles/${TITLE_ID}/master/uuid-1/The Long Quiet.mov`;
const TRAILER_KEY = `orgs/${ORG_ID}/titles/${TITLE_ID}/trailer/uuid-2/teaser.mp4`;
const EXPECTED_SCREENER_KEY = `orgs/${ORG_ID}/titles/${TITLE_ID}/screener/uuid-1/The Long Quiet_screener.mp4`;

type RpcResult = { data: unknown; error: { message: string } | null };

function body(overrides: Partial<{ kind: string; key: string }> = {}) {
  return {
    titleId: TITLE_ID,
    kind: overrides.kind ?? "master",
    key: overrides.key ?? MASTER_KEY,
    uploadId: "upload-1",
    parts: [{ partNumber: 1, etag: "etag-1" }],
    bytes: 1024,
  };
}

function req(payload: unknown) {
  return new Request("http://test/", { method: "POST", body: JSON.stringify(payload) });
}

// rpcResults maps RPC name -> the result that call returns, so a test can make
// create_asset succeed while create_transcode_job fails (or vice versa) without the two
// calls fighting over one canned response.
function fakeSupabase(rpcResults: Record<string, RpcResult>) {
  const rpc = vi.fn(async (fn: string) => rpcResults[fn] ?? { data: null, error: { message: `no fixture for ${fn}` } });
  return { rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthUser).mockResolvedValue({ id: "user-1", email: "u@example.com" });
  vi.mocked(resolveOperableTitle).mockResolvedValue({ orgId: ORG_ID });
  vi.mocked(completeMultipart).mockResolvedValue("content-hash-1");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/assets/complete — transcode submission on master completion", () => {
  it("a master upload submits a proxy job and records it", async () => {
    const supabase = fakeSupabase({
      create_asset: { data: "asset-1", error: null },
      create_transcode_job: { data: "job-row-1", error: null },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(submitProxyJob).mockResolvedValue({ externalJobId: "aws-job-1", expectedKey: EXPECTED_SCREENER_KEY });

    const res = await POST(req(body({ kind: "master" })));
    const json = (await res.json()) as { assetId?: string };

    expect(res.status).toBe(200);
    expect(json.assetId).toBe("asset-1");
    expect(submitProxyJob).toHaveBeenCalledWith({ masterKey: MASTER_KEY });
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_transcode_job",
      expect.objectContaining({
        p_org_id: ORG_ID,
        p_title_id: TITLE_ID,
        p_source_asset_id: "asset-1",
        p_expected_output_key: EXPECTED_SCREENER_KEY,
        p_external_job_id: "aws-job-1",
      }),
    );
  });

  it("a trailer upload does not submit a proxy job", async () => {
    const supabase = fakeSupabase({ create_asset: { data: "asset-2", error: null } });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);

    const res = await POST(req(body({ kind: "trailer", key: TRAILER_KEY })));
    const json = (await res.json()) as { assetId?: string };

    expect(res.status).toBe(200);
    expect(json.assetId).toBe("asset-2");
    expect(submitProxyJob).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalledWith("create_transcode_job", expect.anything());
  });

  // The single most important property in this task: a transcode failure must never cost the
  // client their upload. The master is already in S3 and create_asset has already committed
  // by the time this branch runs.
  //
  // Mutation-checked per the brief: with the route's try/catch temporarily removed, this test
  // failed with the rejection propagating straight out of `POST` —
  //   Error: MediaConvert unreachable
  //     at src/app/api/assets/complete/route.test.ts:113
  // — i.e. the route never returned a response at all, let alone 200. Restoring the try/catch
  // made it pass again. Observed by actually deleting the block and re-running, not assumed.
  it("a submit that throws still returns 200 with the assetId", async () => {
    const supabase = fakeSupabase({ create_asset: { data: "asset-3", error: null } });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(submitProxyJob).mockRejectedValue(new Error("MediaConvert unreachable"));

    const res = await POST(req(body({ kind: "master" })));
    const json = (await res.json()) as { assetId?: string };

    expect(res.status).toBe(200);
    expect(json.assetId).toBe("asset-3");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("MediaConvert unreachable"));
    // The submit threw, so there is nothing to record — create_transcode_job must not run.
    expect(supabase.rpc).not.toHaveBeenCalledWith("create_transcode_job", expect.anything());
  });

  it("a create_transcode_job RPC error (e.g. 23505 on a resubmit) is logged and still returns 200", async () => {
    const supabase = fakeSupabase({
      create_asset: { data: "asset-4", error: null },
      create_transcode_job: {
        data: null,
        error: { message: 'duplicate key value violates unique constraint "transcode_jobs_expected_output_key_key" (23505)' },
      },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(submitProxyJob).mockResolvedValue({ externalJobId: "aws-job-4", expectedKey: EXPECTED_SCREENER_KEY });

    const res = await POST(req(body({ kind: "master" })));
    const json = (await res.json()) as { assetId?: string };

    expect(res.status).toBe(200);
    expect(json.assetId).toBe("asset-4");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("23505"));
  });

  // Mutation-checked per the brief for the OTHER submitProxyJob failure mode: a rejecting
  // fake (this one) is what actually exercises the try/catch's "RPC throws mid-call" branch —
  // a fake that only ever returns { error } (like fakeSupabase above) can never reach it,
  // since a returned error and a thrown rejection take different code paths in the route.
  it("a create_transcode_job call that rejects outright (not merely returns an error) is still contained", async () => {
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "create_asset") return { data: "asset-5", error: null };
      if (fn === "create_transcode_job") throw new Error("connection reset mid-call");
      return { data: null, error: { message: `no fixture for ${fn}` } };
    });
    vi.mocked(createClient).mockResolvedValue({ rpc } as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(submitProxyJob).mockResolvedValue({ externalJobId: "aws-job-5", expectedKey: EXPECTED_SCREENER_KEY });

    const res = await POST(req(body({ kind: "master" })));
    const json = (await res.json()) as { assetId?: string };

    expect(res.status).toBe(200);
    expect(json.assetId).toBe("asset-5");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("connection reset mid-call"));
  });

  // Review finding: zod's z.string().uuid() accepts an uppercase UUID, but Postgres renders
  // p_title_id::text canonically lowercase — so create_transcode_job's LIKE scope check would
  // miss on a case mismatch alone, raise 'out of scope', and (per this route's own deliberate
  // error-swallowing above) silently leave that master without a proxy, forever. The route
  // must normalize titleId before it reaches the key-prefix check or any RPC.
  it("lowercases an uppercase-cased titleId before it's used in the key check or any RPC call", async () => {
    // Hex letters (a-f), not the digits-only fixture TITLE_ID uses above — toUpperCase() on
    // an all-digits UUID is a no-op and would prove nothing.
    const lowerTitleId = "aaaaaaaa-1111-4111-8111-111111111111";
    const upperTitleId = lowerTitleId.toUpperCase();
    const masterKey = `orgs/${ORG_ID}/titles/${lowerTitleId}/master/uuid-6/reel.mov`;
    const expectedKey = `orgs/${ORG_ID}/titles/${lowerTitleId}/screener/uuid-6/reel_screener.mp4`;

    const supabase = fakeSupabase({
      create_asset: { data: "asset-6", error: null },
      create_transcode_job: { data: "job-row-6", error: null },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as unknown as Awaited<ReturnType<typeof createClient>>);
    vi.mocked(submitProxyJob).mockResolvedValue({ externalJobId: "aws-job-6", expectedKey });

    const res = await POST(
      req({
        titleId: upperTitleId,
        kind: "master",
        key: masterKey,
        uploadId: "upload-1",
        parts: [{ partNumber: 1, etag: "etag-1" }],
        bytes: 1024,
      }),
    );
    const json = (await res.json()) as { assetId?: string };

    expect(res.status).toBe(200);
    expect(json.assetId).toBe("asset-6");
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_asset",
      expect.objectContaining({ p_title_id: lowerTitleId }),
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_transcode_job",
      expect.objectContaining({ p_title_id: lowerTitleId }),
    );
  });
});
