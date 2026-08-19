import { beforeEach, describe, expect, it, vi } from "vitest";

import { getOrgContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgTier } from "@/lib/org-tier";
import { ASK_GLOBEE } from "@/lib/ask-globee";
import { CATALOG_HEALTH_EMPTY } from "@/lib/findings";
import {
  appendAskGlobeeTurn,
  startAskGlobeeConversation,
} from "./ask-globee-actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/org-tier", () => ({ getActiveOrgTier: vi.fn() }));

const THREAD = "2f1c8b6a-4d3e-4a11-9c22-7b8e1d0a5f44";
const OTHER_ORG_FINDING = "SECRET_OTHER_ORG";

function ctx({
  isGcStaff = false,
  hasOrg = true,
}: {
  isGcStaff?: boolean;
  hasOrg?: boolean;
} = {}) {
  const org = hasOrg ? { id: "org-1", name: "Meridian Pictures", status: "active" } : null;
  return {
    user: { id: "u1", email: "ada@example.com" },
    rows: org ? [{ role: "account_owner", organizations: org }] : [],
    orgs: org ? [{ id: org.id, name: org.name }] : [],
    activeOrg: org,
    activeRole: org ? "account_owner" : null,
    canOperate: !!org,
    isGcStaff,
    unread: Promise.resolve(0),
  };
}

function stubWriteClient({
  titles = [
    {
      id: "t-cut",
      title: "Harbor Cut",
      status: "draft",
      created_at: "2026-08-16T00:00:00.000Z",
    },
  ],
  findings = [
    {
      org_id: "org-1",
      entity_id: "t-cut",
      message: "Synopsis is required.",
      severity: "high",
    },
    {
      org_id: "org-2",
      entity_id: "t-other",
      message: OTHER_ORG_FINDING,
      severity: "high",
    },
    {
      org_id: "org-1",
      entity_id: "missing-title",
      message: "ORPHAN_FINDING",
      severity: "high",
    },
  ],
  conversationId = THREAD,
}: {
  titles?: { id: string; title: string; status: string; created_at: string }[];
  findings?: {
    org_id: string;
    entity_id: string;
    message?: string | null;
    severity?: string | null;
  }[];
  conversationId?: string;
} = {}) {
  const inserted: { table: string; row: Record<string, unknown> }[] = [];
  const titlesChain = {
    select: vi.fn(() => titlesChain),
    eq: vi.fn(() => titlesChain),
    order: vi.fn(() => titlesChain),
    range: vi.fn(async () => ({ data: titles, error: null })),
  };
  const conversationsInsert = {
    select: vi.fn(() => conversationsInsert),
    single: vi.fn(async () => ({ data: { id: conversationId }, error: null })),
  };
  const conversationsRead = {
    select: vi.fn(() => conversationsRead),
    eq: vi.fn(() => conversationsRead),
    maybeSingle: vi.fn(async () => ({ data: { id: conversationId }, error: null })),
  };
  const from = vi.fn((table: string) => {
    if (table === "titles") return titlesChain;
    if (table === "conversations") {
      return {
        insert: (row: Record<string, unknown>) => {
          inserted.push({ table, row });
          return conversationsInsert;
        },
        select: conversationsRead.select,
        eq: conversationsRead.eq,
        maybeSingle: conversationsRead.maybeSingle,
      };
    }
    if (table === "conversation_messages") {
      return {
        insert: async (row: Record<string, unknown>) => {
          inserted.push({ table, row });
          return { error: null };
        },
      };
    }
    throw new Error(`unexpected from(${table})`);
  });
  const rpc = vi.fn(async (name: string) => {
    if (name === "my_findings") return { data: findings, error: null };
    throw new Error(`unexpected rpc(${name})`);
  });
  vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);
  return { from, rpc, inserted };
}

describe("startAskGlobeeConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses Access and never loads conversations or findings", async () => {
    const { from, rpc } = stubWriteClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("access");

    await expect(startAskGlobeeConversation("What needs attention")).resolves.toEqual({
      error: "Not authorized.",
    });
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("persists an org-filtered answer for Pro and drops other-org findings", async () => {
    const { inserted, rpc } = stubWriteClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("pro");

    await expect(startAskGlobeeConversation("What needs attention")).resolves.toEqual({
      conversationId: THREAD,
    });
    expect(rpc).toHaveBeenCalledWith("my_findings");
    expect(inserted[0]?.table).toBe("conversations");
    expect(inserted[0]?.row).toMatchObject({
      org_id: "org-1",
      title: "What needs attention",
    });
    expect(inserted[1]?.row).toMatchObject({
      role: "user",
      body: "What needs attention",
      org_id: "org-1",
    });
    expect(inserted[2]?.row).toMatchObject({
      role: "globee",
      lead: "Harbor Cut — Synopsis is required.",
      org_id: "org-1",
    });
    const payload = JSON.stringify(inserted);
    expect(payload).not.toContain(OTHER_ORG_FINDING);
    expect(payload).not.toContain("ORPHAN_FINDING");
    expect(payload).not.toContain("Winter Line");
    expect(payload).not.toContain("Harbor Lights");
  });

  it("tells the truth when the catalog is empty", async () => {
    const { inserted } = stubWriteClient({ titles: [], findings: [] });
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("premium");

    await expect(startAskGlobeeConversation("What needs attention")).resolves.toEqual({
      conversationId: THREAD,
    });
    expect(inserted[2]?.row).toMatchObject({
      role: "globee",
      lead: CATALOG_HEALTH_EMPTY,
    });
    expect(JSON.stringify(inserted)).not.toContain("Artwork missing");
  });

  it("answers unmapped free text with the honest capability line", async () => {
    const { inserted } = stubWriteClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("pro");

    await expect(startAskGlobeeConversation("How much revenue did Harbor Cut make?")).resolves.toEqual(
      { conversationId: THREAD },
    );
    expect(inserted[2]?.row).toMatchObject({
      role: "globee",
      lead: ASK_GLOBEE.capability,
    });
    expect(JSON.stringify(inserted[2])).not.toContain("Synopsis is required.");
  });
});

describe("appendAskGlobeeTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("appends both turns to the same conversation", async () => {
    const { inserted } = stubWriteClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("pro");

    await expect(appendAskGlobeeTurn(THREAD, "What is blocking a title")).resolves.toEqual({});
    expect(inserted.some((row) => row.table === "conversations")).toBe(false);
    expect(inserted.map((row) => row.row.role)).toEqual(["user", "globee"]);
    expect(inserted[0]?.row).toMatchObject({
      conversation_id: THREAD,
      body: "What is blocking a title",
    });
    expect(inserted[1]?.row).toMatchObject({
      conversation_id: THREAD,
      role: "globee",
    });
  });

  it("refuses Access follow-ups without loading findings", async () => {
    const { rpc } = stubWriteClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    vi.mocked(getActiveOrgTier).mockResolvedValue("access");

    await expect(appendAskGlobeeTurn(THREAD, "What needs attention")).resolves.toEqual({
      error: "Not authorized.",
    });
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
