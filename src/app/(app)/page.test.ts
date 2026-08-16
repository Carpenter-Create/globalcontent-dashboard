import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { CLIENTS_PAGE, ORG_ROLE_LABELS, ORG_STATUS_LABELS } from "@/lib/clients";
import { DASHBOARD_HOME } from "@/lib/dashboard-home";
import { DASHBOARD_ATTENTION_CLEAR, dashboardAttentionSummary } from "@/lib/findings";
import { UNPAGINATED_MAX } from "@/lib/list-bounds";
import { TITLE_STATUS_LABELS } from "@/lib/titles";
import DashboardPage from "./page";

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

function stubClient(
  titles: {
    id: string;
    title: string;
    status: string;
    created_at: string;
  }[] = [],
  findings: { org_id: string; entity_id: string }[] = [],
) {
  const eq = vi.fn();
  const titlesChain = {
    select: vi.fn(() => titlesChain),
    eq: (...args: unknown[]) => {
      eq(...args);
      return titlesChain;
    },
    order: vi.fn(() => titlesChain),
    range: vi.fn(async () => ({ data: titles, error: null })),
  };
  const from = vi.fn((table: string) => {
    if (table === "titles") return titlesChain;
    throw new Error(`unexpected from(${table})`);
  });
  const rpc = vi.fn(async (name: string) => {
    if (name === "my_findings") return { data: findings, error: null };
    if (name === "gc_client_directory") return { data: [], error: null };
    throw new Error(`unexpected rpc(${name})`);
  });
  vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);
  return { from, eq, rpc, titlesChain };
}

function statValue(html: string, key: string): string | null {
  const match = html.match(new RegExp(`data-dashboard-stat="${key}"[^>]*>([^<]*)<`));
  return match?.[1] ?? null;
}

/**
 * `/` has two legitimate modes. A client org still gets the organization-scoped
 * portfolio. GC staff without a client org stay on `/` and see the existing
 * GC-wide clients roster — not /queue (focused work stays there) and not the
 * client wizard (staff must not create an org).
 */
describe("DashboardPage modes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the organization-scoped portfolio for a user with a client org", async () => {
    const { from, eq, rpc } = stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: false, orgStatus: "active" }) as never,
    );

    const html = renderToStaticMarkup(await DashboardPage());

    expect(from).toHaveBeenCalledWith("titles");
    expect(eq).toHaveBeenCalledWith("org_id", "org-1");
    expect(rpc).toHaveBeenCalledWith("my_findings");
    expect(rpc).not.toHaveBeenCalledWith("gc_client_directory", expect.anything());
    expect(html).toContain("Acme");
    expect(html).toMatch(/<h1 class="t-section text-ink">Acme<\/h1>/);
    expect(html).not.toMatch(/<h1[^>]*t-display/);
    expect(html).toContain(ORG_STATUS_LABELS.active);
    expect(html).toContain(ORG_ROLE_LABELS.account_owner);
    expect(html).toContain(DASHBOARD_ATTENTION_CLEAR);
    expect(html).toContain("/catalog-health");
    expect(html).toContain("data-dashboard-home");
    expect(html).toContain("dashboard-home-pill");
    expect(html).toContain(DASHBOARD_HOME.justInEmpty);
    expect(html).toContain(DASHBOARD_HOME.catalogHealthCta);
    expect(html).toContain("bg-accent");
    expect(html).toContain("text-accent-contrast");
    expect(html).not.toContain("t-body-sm text-accent");
    expect(html).not.toContain(CLIENTS_PAGE.title);
    expect(html).not.toContain(CLIENTS_PAGE.subtitle);
  });

  it("lists just-in titles as ink links, not accent body copy", async () => {
    stubClient([
      {
        id: "title-1",
        title: "Winter Light",
        status: "live",
        created_at: new Date().toISOString(),
      },
    ]);
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: false, orgStatus: "active" }) as never,
    );

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("Winter Light");
    expect(html).toContain("/titles/title-1");
    expect(html).toContain("dashboard-home-panel");
    expect(html).toContain("t-body font-medium text-ink");
    expect(html).not.toContain("t-subhead");
    expect(html).not.toContain("t-title");
    expect(html).not.toContain(DASHBOARD_HOME.justInEmpty);
    expect(html).not.toContain("t-body-sm text-accent");
  });

  it("still renders the client portfolio when GC staff also hold a client org", async () => {
    const { rpc } = stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: true, orgStatus: "active" }) as never,
    );

    const html = renderToStaticMarkup(await DashboardPage());

    expect(rpc).toHaveBeenCalledWith("my_findings");
    expect(rpc).not.toHaveBeenCalledWith("gc_client_directory", expect.anything());
    expect(html).toContain("Acme");
    expect(html).toContain("data-dashboard-snapshot");
    expect(html).not.toContain(CLIENTS_PAGE.subtitle);
  });

  it("renders the GC-wide clients roster at / for staff with no client org", async () => {
    const { from, rpc } = stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: true, orgStatus: null }) as never,
    );

    const page = await DashboardPage();
    const html = renderToStaticMarkup(page);

    expect(rpc).toHaveBeenCalledWith("gc_client_directory", { p_limit: UNPAGINATED_MAX + 1 });
    expect(from).not.toHaveBeenCalledWith("titles");
    expect(html).toContain(CLIENTS_PAGE.title);
    expect(html).toContain(CLIENTS_PAGE.subtitle);
    expect(html).toContain(CLIENTS_PAGE.empty);
    expect(html).not.toContain("Dashboard —");
    expect(html).not.toContain("/catalog-health");
    expect(html).not.toContain("data-dashboard-home");
    expect(html).not.toContain("dashboard-home-pill");
    expect(html).not.toContain(DASHBOARD_HOME.justInEmpty);
    expect(html).not.toContain("data-dashboard-snapshot");
    expect(html).not.toContain(DASHBOARD_HOME.doNext);
  });

  it("does not send GC staff with no client org to /queue or the wizard", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: true, orgStatus: null }) as never,
    );

    await expect(DashboardPage()).resolves.toBeTruthy();
  });

  it("still sends a non-GC user with no org to onboarding", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: false, orgStatus: null }) as never,
    );
    await expect(DashboardPage()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("sends an unauthenticated visitor to login", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    await expect(DashboardPage()).rejects.toThrow("REDIRECT:/login");
  });
});

describe("client home information model", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows three numbers, Do next, Just in, and no chart or revenue", async () => {
    stubClient(
      [
        {
          id: "title-1",
          title: "Winter Light",
          status: "live",
          created_at: new Date().toISOString(),
        },
        {
          id: "title-2",
          title: "Draft Work",
          status: "draft",
          created_at: new Date().toISOString(),
        },
      ],
      [{ org_id: "org-1", entity_id: "title-1" }],
    );
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: false, orgStatus: "active" }) as never,
    );

    const html = renderToStaticMarkup(await DashboardPage());

    expect(statValue(html, "catalog")).toBe("2");
    expect(statValue(html, "needsAttention")).toBe("1");
    expect(statValue(html, "live")).toBe("1");
    expect(html).toMatch(/<h1 class="t-section text-ink">Acme<\/h1>/);
    expect(html).toMatch(/data-dashboard-stat="catalog"[^>]*t-display t-data/);
    expect(html).toMatch(/data-dashboard-stat="needsAttention"[^>]*t-display t-data/);
    expect(html).toMatch(/data-dashboard-stat="live"[^>]*t-display t-data/);
    expect(html).not.toMatch(/data-dashboard-stat="[^"]*"[^>]*t-title/);
    expect(html).not.toMatch(/<h1[^>]*t-display/);
    expect(html).toContain(`t-label text-ink-3">${DASHBOARD_HOME.catalog}`);
    expect(html).toContain(`t-label text-ink-3">${DASHBOARD_HOME.doNext}`);
    expect(html).toContain(`t-label text-ink-3">${DASHBOARD_HOME.justIn}`);
    expect(html).toContain(DASHBOARD_HOME.catalog);
    expect(html).toContain(DASHBOARD_HOME.needsAttention);
    expect(html).toContain(DASHBOARD_HOME.live);
    expect(html).toContain(DASHBOARD_HOME.doNext);
    expect(html).toContain(dashboardAttentionSummary(1));
    expect(html).toContain("t-body font-medium text-ink");
    expect(html).not.toContain("t-subhead");
    expect(html).toContain("Draft Work");
    expect(html).toContain(TITLE_STATUS_LABELS.draft);
    expect(html).toContain("Winter Light");
    expect(html).toContain(DASHBOARD_HOME.justIn);
    expect(html).toContain(`${ORG_STATUS_LABELS.active} · ${ORG_ROLE_LABELS.account_owner}`);
    expect(html).toContain("text-accent");
    expect(html).not.toContain("Revenue");
    expect(html).not.toContain("Upcoming");
    expect(html).not.toContain("Catalog activity");
    expect(html).not.toContain("dashboard-home-hero");
    expect(html).not.toContain("bg-band");
    expect(html).not.toContain("Access");
    expect(html).not.toContain("term ends");
    expect(html).not.toMatch(/>—</);
  });

  it("does not invent a stuck-too-long metric for drafts", async () => {
    stubClient([
      {
        id: "title-2",
        title: "Draft Work",
        status: "draft",
        created_at: "2024-01-01T00:00:00.000Z",
      },
    ]);
    vi.mocked(getOrgContext).mockResolvedValue(
      ctx({ isGcStaff: false, orgStatus: "active" }) as never,
    );

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("Draft Work");
    expect(html).toContain(TITLE_STATUS_LABELS.draft);
    expect(html).not.toMatch(/stuck/i);
    expect(html).not.toContain(DASHBOARD_ATTENTION_CLEAR);
  });
});
