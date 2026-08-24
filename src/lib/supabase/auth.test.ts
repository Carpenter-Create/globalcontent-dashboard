import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});
vi.mock("./server", () => ({ createClient: vi.fn() }));

import { createClient } from "./server";
import { getAuthUser } from "./auth";

function claimsClient(claims: Record<string, unknown> | null, error: { message: string } | null = null) {
  const getClaims = vi.fn(async () => ({
    data: claims ? { claims } : { claims: null },
    error,
  }));
  vi.mocked(createClient).mockResolvedValue({ auth: { getClaims } } as never);
  return { getClaims };
}

describe("getAuthUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns email and an existing display_name from JWT claims", async () => {
    claimsClient({
      sub: "user-1",
      email: "ada@example.com",
      user_metadata: { display_name: "Ada Lovelace" },
    });
    await expect(getAuthUser()).resolves.toEqual({
      id: "user-1",
      email: "ada@example.com",
      name: "Ada Lovelace",
    });
  });

  it("leaves name empty and does not invent one from the email", async () => {
    claimsClient({
      sub: "user-1",
      email: "jane.doe@studio.com",
      user_metadata: {},
    });
    await expect(getAuthUser()).resolves.toEqual({
      id: "user-1",
      email: "jane.doe@studio.com",
      name: null,
    });
  });
});
