import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  AVATAR_ACCEPT,
  AVATAR_CONTENT_TYPES,
  AVATAR_KEY_PREFIX,
  AVATAR_MAX_BYTES,
  AVATAR_OBJECT_NAME,
  AVATAR_SIGNED_URL_TTL_SECONDS,
  avatarObjectKey,
  isAvatarContentType,
  isAvatarObjectKey,
} from "./account-avatar";

const UID = "11111111-1111-4111-8111-111111111111";
const here = dirname(fileURLToPath(import.meta.url));
const avatarSrc = readFileSync(join(here, "account-avatar.ts"), "utf8");
const s3AvatarsSrc = readFileSync(join(here, "s3-avatars.ts"), "utf8");
const s3TitlesSrc = readFileSync(join(here, "s3.ts"), "utf8");
const assetsSrc = readFileSync(join(here, "assets.ts"), "utf8");

describe("avatarObjectKey", () => {
  it("is avatars/{user-id}/avatar and nothing else", () => {
    expect(avatarObjectKey(UID)).toBe(`avatars/${UID}/avatar`);
    expect(AVATAR_KEY_PREFIX).toBe("avatars");
    expect(AVATAR_OBJECT_NAME).toBe("avatar");
    expect(isAvatarObjectKey(`avatars/${UID}/avatar`, UID)).toBe(true);
  });

  it("rejects a non-UUID so title paths cannot be smuggled in", () => {
    expect(() => avatarObjectKey("u1")).toThrow(/UUID/);
    expect(() => avatarObjectKey("../titles/x")).toThrow(/UUID/);
    expect(() => avatarObjectKey(`orgs/o/titles/t/poster/${UID}/file`)).toThrow(/UUID/);
    expect(isAvatarObjectKey(`orgs/o/titles/t/poster/${UID}/file`, UID)).toBe(false);
    expect(isAvatarObjectKey(`avatars/${UID}/avatar`, "22222222-2222-4222-8222-222222222222")).toBe(
      false,
    );
  });
});

describe("avatar content rules", () => {
  it("allows jpeg/png/webp only, caps at 2 MB, and signs for 5 minutes", () => {
    expect(AVATAR_CONTENT_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(isAvatarContentType("image/jpeg")).toBe(true);
    expect(isAvatarContentType("image/png")).toBe(true);
    expect(isAvatarContentType("image/webp")).toBe(true);
    expect(isAvatarContentType("image/gif")).toBe(false);
    expect(isAvatarContentType("application/octet-stream")).toBe(false);
    expect(AVATAR_ACCEPT).toBe("image/jpeg,image/png,image/webp");
    expect(AVATAR_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(AVATAR_SIGNED_URL_TTL_SECONDS).toBe(300);
  });
});

describe("avatars stay off the title bucket", () => {
  it("never mentions S3_BUCKET, title keys, CloudFront, or Supabase Storage", () => {
    expect(avatarSrc).not.toContain("process.env.S3_BUCKET");
    expect(avatarSrc).not.toMatch(/orgs\/\$\{/);
    expect(s3AvatarsSrc).toContain("S3_AVATARS_BUCKET");
    expect(s3AvatarsSrc).toContain("must be a dedicated bucket, not S3_BUCKET");
    expect(s3AvatarsSrc).not.toMatch(/from ["']@\/lib\/s3["']/);
    expect(s3AvatarsSrc).not.toContain("CLOUDFRONT");
    expect(s3AvatarsSrc).not.toContain("supabase.storage");
    expect(s3TitlesSrc).not.toContain("S3_AVATARS_BUCKET");
    expect(assetsSrc).toContain("orgs/${orgId}/titles/");
    expect(assetsSrc).not.toContain("avatars/");
  });
});
