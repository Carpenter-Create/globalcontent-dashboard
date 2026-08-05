import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";

// presignGetObject would need real AWS credential resolution, so stub it. What matters here
// is WHICH branch assetViewUrl takes, not what S3's signature looks like.
vi.mock("./s3", () => ({
  presignGetObject: vi.fn(async (key: string) => `https://s3.local/${key}?X-Amz-Signature=stub`),
  S3_BUCKET: "gc-content-assets-dev",
}));

const KEY = "orgs/x/titles/y/poster/z/art.jpg";
const CF_VARS = ["CLOUDFRONT_DOMAIN", "CLOUDFRONT_KEY_PAIR_ID", "CLOUDFRONT_PRIVATE_KEY"] as const;

function setCloudFrontEnv() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.CLOUDFRONT_DOMAIN = "https://d.example.net";
  process.env.CLOUDFRONT_KEY_PAIR_ID = "KTESTPAIRID";
  process.env.CLOUDFRONT_PRIVATE_KEY = privateKey
    .export({ type: "pkcs1", format: "pem" })
    .toString();
}

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(CF_VARS.map((k) => [k, process.env[k]]));
  for (const k of CF_VARS) delete process.env[k];
  vi.resetModules();
  // resetModules re-imports, but the hoisted mock fn instance persists — its call history
  // would otherwise leak between tests and make the "never called" assertion meaningless.
  vi.clearAllMocks();
});

afterEach(() => {
  for (const k of CF_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllEnvs();
});

describe("assetViewUrl", () => {
  it("uses CloudFront whenever CLOUDFRONT_DOMAIN is set", async () => {
    setCloudFrontEnv();
    const { assetViewUrl } = await import("./asset-url");
    const url = await assetViewUrl(KEY);
    expect(url).toContain("https://d.example.net/" + KEY);
    expect(url).toContain("Key-Pair-Id=KTESTPAIRID");
    expect(url).not.toContain("s3.local");
  });

  it("prefers CloudFront even locally — production parity by default", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    setCloudFrontEnv();
    const { assetViewUrl } = await import("./asset-url");
    expect(await assetViewUrl(KEY)).toContain("https://d.example.net/");
  });

  it("falls back to an S3 presign outside production when CloudFront is unset", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    const { assetViewUrl } = await import("./asset-url");
    const url = await assetViewUrl(KEY);
    // This is the fix: a dev-bucket key is servable locally, so artwork renders instead of
    // silently falling through to the monogram placeholder.
    expect(url).toBe(`https://s3.local/${KEY}?X-Amz-Signature=stub`);
  });

  // THE SECURITY BOUNDARY. An S3 presign would genuinely succeed in production — the app's
  // IAM policy grants s3:GetObject on both buckets — and would bypass CloudFront, OAC and
  // the signing key group. Missing config must fail loudly, never degrade into a bypass.
  it("REFUSES to presign S3 on a PRODUCTION DEPLOYMENT when CloudFront is unset", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const { assetViewUrl } = await import("./asset-url");
    await expect(assetViewUrl(KEY)).rejects.toThrow(/CLOUDFRONT_DOMAIN is not set/);
  });

  it("does not leak an S3 URL when it refuses on a production deployment", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const { assetViewUrl } = await import("./asset-url");
    await expect(assetViewUrl(KEY)).rejects.toThrow();
    const { presignGetObject } = await import("./s3");
    expect(presignGetObject).not.toHaveBeenCalled();
  });
  // The exact bug this replaced: `next start` sets NODE_ENV=production, so a production
  // build on a laptop looked like the live site and the guard fired. VERCEL_ENV is the
  // signal that actually distinguishes them.
  it("still presigns under a local production BUILD (next start sets NODE_ENV=production)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "");
    const { assetViewUrl } = await import("./asset-url");
    expect(await assetViewUrl(KEY)).toBe(`https://s3.local/${KEY}?X-Amz-Signature=stub`);
  });

  it("refuses on a production deployment even though NODE_ENV alone cannot tell them apart", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    const { assetViewUrl } = await import("./asset-url");
    await expect(assetViewUrl(KEY)).rejects.toThrow();
  });
});
