import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Same local-mock idiom as ../complete/route.test.ts: the smallest fake that covers what this
// route actually calls. assetKey and PART_SIZE come from the REAL module (not mocked) —
// this test's whole point is proving the route's zod-normalized titleId reaches the real
// assetKey() lowercased, so faking assetKey would test nothing.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/assets", async () => {
  const actual = await vi.importActual<typeof import("@/lib/assets")>("@/lib/assets");
  return { ...actual, resolveOperableTitle: vi.fn() };
});
vi.mock("@/lib/s3", () => ({ createMultipart: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { resolveOperableTitle } from "@/lib/assets";
import { createMultipart } from "@/lib/s3";
import { POST } from "./route";

const ORG_ID = "org-1";
// A UUID that actually differs under case-folding (has hex letters a-f) — a digits-only
// fixture like "11111111-..." would make toUpperCase() a no-op and prove nothing.
const LOWER_TITLE_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const UPPER_TITLE_ID = LOWER_TITLE_ID.toUpperCase();

function req(payload: unknown) {
  return new Request("http://test/", { method: "POST", body: JSON.stringify(payload) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthUser).mockResolvedValue({ id: "user-1", email: "u@example.com", name: null });
  vi.mocked(resolveOperableTitle).mockResolvedValue({ orgId: ORG_ID });
  vi.mocked(createMultipart).mockResolvedValue("upload-1");
  vi.mocked(createClient).mockResolvedValue({} as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/assets/initiate — titleId case normalization", () => {
  it("lowercases an uppercase-cased titleId before it reaches assetKey()'s S3 key", async () => {
    const res = await POST(
      req({ titleId: UPPER_TITLE_ID, kind: "master", filename: "film.mov", bytes: 1024 }),
    );
    const json = (await res.json()) as { key?: string };

    expect(res.status).toBe(200);
    // Postgres renders p_title_id::text canonically lowercase, so the LIKE scope check in
    // create_transcode_job only matches a key built from a lowercased titleId. A key still
    // carrying the uppercase segment would pass zod's format check today and fail that
    // comparison later, silently, on the transcode path.
    expect(json.key).toContain(`/titles/${LOWER_TITLE_ID}/`);
    expect(json.key).not.toContain(UPPER_TITLE_ID);

    // resolveOperableTitle itself must also see the normalized value — it's what
    // create_transcode_job will scope-check against later.
    expect(resolveOperableTitle).toHaveBeenCalledWith(expect.anything(), LOWER_TITLE_ID, "user-1");
  });
});
