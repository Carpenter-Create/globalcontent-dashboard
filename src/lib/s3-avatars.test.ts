import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSend, mockGetSignedUrl } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGetSignedUrl: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(function S3ClientMock() {
      return { send: mockSend };
    }),
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mockGetSignedUrl,
}));

import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { headAvatarObject, presignAvatarGet, putAvatarObject, signedAvatarUrl } from "./s3-avatars";

const UID = "11111111-1111-4111-8111-111111111111";
const KEY = `avatars/${UID}/avatar`;

describe("s3-avatars dedicated bucket", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
    process.env.S3_AVATARS_BUCKET = "test-avatars-bucket";
    process.env.S3_BUCKET = "test-bucket";
  });

  it("PUTs to S3_AVATARS_BUCKET under avatars/{uid}/avatar, not S3_BUCKET", async () => {
    mockSend.mockResolvedValueOnce({});
    const body = new Uint8Array([1, 2, 3]);
    await putAvatarObject(UID, body, "image/jpeg");
    expect(mockSend).toHaveBeenCalledTimes(1);
    const cmd = mockSend.mock.calls[0]?.[0] as PutObjectCommand;
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input.Bucket).toBe("test-avatars-bucket");
    expect(cmd.input.Bucket).not.toBe(process.env.S3_BUCKET);
    expect(cmd.input.Key).toBe(KEY);
    expect(cmd.input.ContentType).toBe("image/jpeg");
    expect(cmd.input.ACL).toBeUndefined();
  });

  it("refuses when S3_AVATARS_BUCKET is the title bucket", async () => {
    process.env.S3_AVATARS_BUCKET = process.env.S3_BUCKET;
    await expect(putAvatarObject(UID, new Uint8Array([1]), "image/jpeg")).rejects.toThrow(
      /dedicated bucket/,
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("HEADs the avatars bucket only — missing key is empty, not an invented photo", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }),
    );
    await expect(headAvatarObject(UID)).resolves.toBe(false);
    const cmd = mockSend.mock.calls[0]?.[0] as HeadObjectCommand;
    expect(cmd).toBeInstanceOf(HeadObjectCommand);
    expect(cmd.input.Bucket).toBe("test-avatars-bucket");
    expect(cmd.input.Key).toBe(KEY);
  });

  it("signs a short-lived GET on the avatars bucket", async () => {
    mockGetSignedUrl.mockResolvedValueOnce("https://s3.example/signed-avatar");
    await expect(presignAvatarGet(UID)).resolves.toBe("https://s3.example/signed-avatar");
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    const [, , opts] = mockGetSignedUrl.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { expiresIn: number },
    ];
    expect(opts.expiresIn).toBe(300);
  });

  it("returns null when no object exists so the card stays empty", async () => {
    mockSend.mockRejectedValueOnce(
      Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }),
    );
    await expect(signedAvatarUrl(UID)).resolves.toBeNull();
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });
});
