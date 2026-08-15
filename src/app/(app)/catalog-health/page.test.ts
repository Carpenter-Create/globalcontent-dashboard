import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { CATALOG_HEALTH_EMPTY, CATALOG_HEALTH_SUBTITLE } from "@/lib/findings";
import CatalogHealthPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

type Status = "registered" | "awaiting_payment" | "active";

function ctx({ isGcStaff, orgStatus }: { isGcStaff: boolean; orgStatus: Status | null }) {
  const org = orgStatus ? { id: "org-1", name: "Acme", status: orgStatus } : null;
  return {
    user: { id: "u1", email: "someone@example.com" },
    rows: org ? [{ role: "account_owner", organizations: org }] : [],
    orgs: org ? [{ id: org.id, name: org.name }] : [],
    activeOrg: org,
    activeRole: org ? "account_owner" : null,
    canOperate: !!org,
    isGcStaff,
    unread: Promise.resolve(0),
  };
}

const CROSS_ORG_FINDINGS = [
  {
    id: "f-acme",
    org_id: "org-1",
    entity_id: "title-acme",
    message: "Synopsis is required.",
    severity: "high",
  },
  {
    id: "f-other",
    org_id: "org-2",
    entity_id: "title-other",
    message: "Genre is required.",
    severity: "high",
  },
];

const TITLE_ROWS = [
  {
    id: "title-acme",
    title: "Acme Film",
    catalog_id: "GC-ACME",
    organizations: { name: "Acme" },
  },
  {
    id: "title-other",
    title: "Other Film",
    catalog_id: "GC-OTHER",
    organizations: { name: "Other Client" },
  },
];

function stubClient() {
  const titlesChain = {
    select: vi.fn(() => titlesChain),
    in: vi.fn(() => titlesChain),
    range: vi.fn(async () => ({ data: TITLE_ROWS, error: null })),
  };
  const from = vi.fn((table: string) => {
    if (table === "titles") return titlesChain;
    throw new Error(`unexpected from(${table})`);
  });
  const rpc = vi.fn(async (name: string) => {
    if (name === "my_findings") return { data: CROSS_ORG_FINDINGS, error: null };
    throw new Error(`unexpected rpc(${name})`);
  });
  vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);
  return { from, rpc, titlesChain };
}

/**
 * Catalog Health has two modes. A client org stays org-scoped. GC staff with no
 * client org stay on /catalog-health and see the existing findings UI across
 * every org — not /queue, not /, and not the wizard.
 */
describe("CatalogHealthPage modes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders GC-wide findings at /catalog-health for staff with no client org", async () => {
    const { rpc } = stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: true, orgStatus: null }) as never,
    );

    const html = renderToStaticMarkup(await CatalogHealthPage());

    expect(rpc).toHaveBeenCalledWith("my_findings");
    expect(html).toContain("Catalog Health");
    expect(html).toContain(CATALOG_HEALTH_SUBTITLE);
    expect(html).toContain("Acme Film");
    expect(html).toContain("Other Film");
    expect(html).toContain("Other Client");
    expect(html).toContain("/gc/titles/title-acme");
    expect(html).toContain("/gc/titles/title-other");
    expect(html).not.toContain("/titles/title-acme/metadata");
    expect(html).not.toContain(CATALOG_HEALTH_EMPTY);
  });

  it("does not send GC staff with no client org to /queue, /, or the wizard", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: true, orgStatus: null }) as never,
    );
    await expect(CatalogHealthPage()).resolves.toBeTruthy();
  });

  it("keeps the org-scoped catalog for a user with a client org", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: false, orgStatus: "active" }) as never,
    );

    const html = renderToStaticMarkup(await CatalogHealthPage());

    expect(html).toContain("Acme Film");
    expect(html).toContain("/titles/title-acme/metadata");
    expect(html).not.toContain("Other Film");
    expect(html).not.toContain("/gc/titles/");
  });

  it("still scopes to the client org when GC staff also hold one", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: true, orgStatus: "active" }) as never,
    );

    const html = renderToStaticMarkup(await CatalogHealthPage());

    expect(html).toContain("Acme Film");
    expect(html).toContain("/titles/title-acme/metadata");
    expect(html).not.toContain("Other Film");
  });

  it("still sends a non-GC user with no org to onboarding", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: false, orgStatus: null }) as never,
    );
    await expect(CatalogHealthPage()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("sends an unauthenticated visitor to login", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    await expect(CatalogHealthPage()).rejects.toThrow("REDIRECT:/login");
  });
});
