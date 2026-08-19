import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/server";
import { getActiveOrgTier } from "@/lib/org-tier";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

function stubReads(input: {
  term?: { tier: string } | null;
  assentRaw?: { tier?: string } | null;
}) {
  const termChain = {
    select: vi.fn(() => termChain),
    eq: vi.fn(() => termChain),
    is: vi.fn(() => termChain),
    order: vi.fn(() => termChain),
    limit: vi.fn(() => termChain),
    maybeSingle: vi.fn(async () => ({ data: input.term ?? null, error: null })),
  };
  const assentChain = {
    select: vi.fn(() => assentChain),
    eq: vi.fn(() => assentChain),
    order: vi.fn(() => assentChain),
    limit: vi.fn(() => assentChain),
    maybeSingle: vi.fn(async () => ({
      data: input.assentRaw === undefined ? null : { source_documents: { raw: input.assentRaw } },
      error: null,
    })),
  };
  const from = vi.fn((table: string) => {
    if (table === "contract_terms") return termChain;
    if (table === "contract_assents") return assentChain;
    throw new Error(`unexpected from(${table})`);
  });
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { from };
}

describe("getActiveOrgTier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the current contract_terms.tier when RLS returns it", async () => {
    stubReads({ term: { tier: "premium" } });
    await expect(getActiveOrgTier("org-term-premium")).resolves.toBe("premium");
  });

  it("falls back to the latest assent source_documents.raw.tier", async () => {
    stubReads({ term: null, assentRaw: { tier: "pro" } });
    await expect(getActiveOrgTier("org-assent-pro")).resolves.toBe("pro");
  });

  it("returns null when no real tier is readable", async () => {
    stubReads({ term: null, assentRaw: null });
    await expect(getActiveOrgTier("org-unknown")).resolves.toBeNull();
  });

  it("ignores an unknown tier string instead of inventing one", async () => {
    stubReads({ term: { tier: "enterprise" }, assentRaw: { tier: "gold" } });
    await expect(getActiveOrgTier("org-invalid")).resolves.toBeNull();
  });
});
