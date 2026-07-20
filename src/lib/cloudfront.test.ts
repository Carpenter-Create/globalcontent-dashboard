import { describe, expect, it, beforeAll } from "vitest";
import { generateKeyPairSync } from "node:crypto";

describe("signAssetUrl", () => {
  beforeAll(() => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.CLOUDFRONT_DOMAIN = "https://d.example.net";
    process.env.CLOUDFRONT_KEY_PAIR_ID = "KTESTPAIRID";
    process.env.CLOUDFRONT_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  });

  it("produces a signed URL for a storage key", async () => {
    const { signAssetUrl } = await import("./cloudfront");
    const url = signAssetUrl("orgs/x/titles/y/master/z/film.mov");
    expect(url).toContain("https://d.example.net/orgs/x/titles/y/master/z/film.mov");
    expect(url).toContain("Key-Pair-Id=KTESTPAIRID");
    expect(url).toMatch(/Signature=/);
    expect(url).toMatch(/Expires=/);
  });
});
