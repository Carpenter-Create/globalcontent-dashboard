import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { CLIENTS_PAGE } from "@/lib/clients";
import { DASHBOARD_HOME } from "@/lib/dashboard-home";
import { DASHBOARD_ATTENTION_CLEAR } from "@/lib/findings";
import { UNPAGINATED_MAX } from "@/lib/list-bounds";
import DashboardPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/components/dashboard/catalog-activity-hero", () => ({
  CatalogActivityHero: () => null,
}));

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
    catalog_id: string | null;
    status: string;
    release_date: string | null;
    created_at: string;
  }[] = [],
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
    if (name === "my_findings") return { data: [], error: null };
    if (name === "gc_client_directory") return { data: [], error: null };
    throw new Error(`unexpected rpc(${name})`);
  });
  vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);
  return { from, eq, rpc, titlesChain };
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
    expect(html).toContain("Dashboard — Acme");
    expect(html).toContain("Acme");
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
        catalog_id: null,
        status: "live",
        release_date: null,
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
    expect(html).toContain("Dashboard — Acme");
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
