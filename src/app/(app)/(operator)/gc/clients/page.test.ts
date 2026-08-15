import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { UNPAGINATED_MAX } from "@/lib/list-bounds";

import GcClientsPage from "./page";

/**
 * The bound has to be a PROBE, not the page size: asking for exactly UNPAGINATED_MAX rows
 * returns a truncated list that looks complete, which is the failure list-bounds.ts exists
 * to prevent. This asserts the page asks for one more than it shows.
 */
describe("GcClientsPage read bound", () => {
  beforeEach(() => vi.clearAllMocks());

  it("probes one row past the cap so truncation can be detected", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);

    await GcClientsPage();

    expect(rpc).toHaveBeenCalledWith("gc_client_directory", { p_limit: UNPAGINATED_MAX + 1 });
  });

  it("renders without a client org present", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);

    await expect(GcClientsPage()).resolves.toBeTruthy();
  });
});
