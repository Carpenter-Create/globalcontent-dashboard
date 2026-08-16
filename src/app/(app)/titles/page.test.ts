import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { TITLE_STATUS_LABELS, type TitleStatus } from "@/lib/titles";
import { TITLES_CATALOG } from "@/lib/titles-catalog";
import { NAV } from "@/lib/nav";
import TitlesPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  useRouter: () => ({ refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/titles",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/context", () => ({ getOrgContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/artwork", () => ({
  titleArtworkUrls: vi.fn(async () => new Map()),
}));

const ALL_STATUSES: TitleStatus[] = [
  "draft",
  "submitted",
  "in_review",
  "in_delivery",
  "live",
  "takedown_requested",
  "taken_down",
];

function ctx({
  canOperate = true,
  isGcStaff = false,
  hasOrg = true,
}: {
  canOperate?: boolean;
  isGcStaff?: boolean;
  hasOrg?: boolean;
} = {}) {
  const org = hasOrg ? { id: "org-1", name: "Acme", status: "active" } : null;
  return {
    user: { id: "u1", email: "someone@example.com" },
    rows: org ? [{ role: "account_owner", organizations: org }] : [],
    orgs: org ? [{ id: org.id, name: org.name }] : [],
    activeOrg: org,
    activeRole: org ? "account_owner" : null,
    canOperate: hasOrg && canOperate,
    isGcStaff,
    unread: Promise.resolve(0),
  };
}

function titleRow(status: TitleStatus, i: number) {
  return {
    id: `title-${status}`,
    title: `${status} film`,
    status,
    created_at: `2026-08-${String(10 + i).padStart(2, "0")}T00:00:00Z`,
    catalog_id: `GC-${i}`,
    release_date: null,
  };
}

function stubClient(
  titles: ReturnType<typeof titleRow>[] = ALL_STATUSES.map(titleRow),
) {
  const titlesChain = {
    select: vi.fn(() => titlesChain),
    eq: vi.fn(() => titlesChain),
    order: vi.fn(() => titlesChain),
    range: vi.fn(async () => ({ data: titles, error: null })),
  };
  const from = vi.fn((table: string) => {
    if (table === "titles") return titlesChain;
    throw new Error(`unexpected from(${table})`);
  });
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { from, titlesChain };
}

async function renderCatalog(
  search: Record<string, string | string[] | undefined> = {},
) {
  return renderToStaticMarkup(await TitlesPage({ searchParams: Promise.resolve(search) }));
}

describe("client /titles catalog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists every lifecycle state on one catalog page", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);

    const html = await renderCatalog();

    expect(html).toContain("data-titles-catalog");
    expect(html).toContain("data-titles-catalog-grid");
    expect(html).toContain("lg:grid-cols-3");
    expect(html).toContain("aspect-[2/3]");
    expect(html).not.toContain("lg:grid-cols-2");
    expect(html).not.toContain("aspect-[16/9]");
    expect(html).not.toContain("xl:grid-cols-4");
    expect(html).not.toContain("Recently added");
    expect(html).not.toContain("Spotlight");

    for (const status of ALL_STATUSES) {
      expect(html).toContain(`${status} film`);
      expect(html).toContain(`/titles/title-${status}`);
      expect(html).toContain(`data-title-status="${status}"`);
      expect(html).toContain(TITLE_STATUS_LABELS[status]);
    }
  });

  it("keeps search, Add Title, and quiet status pills — no SaaS subtitle", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);

    const html = await renderCatalog();

    expect(html).toContain(TITLES_CATALOG.title);
    expect(html).toContain("Search titles");
    expect(html).toContain(TITLES_CATALOG.addTitle);
    expect(html).toContain("data-add-title");
    expect(html).toContain("bg-accent");
    expect(html).not.toContain("titles in Acme");
    expect(html).not.toContain("in Acme's catalog");
    expect(html).not.toMatch(/t-label[^>]*data-titles-catalog-status/);

    const statusPills = html.match(/data-titles-catalog-status=""/g) ?? [];
    expect(statusPills).toHaveLength(ALL_STATUSES.length);
    expect(html).toContain("rounded-full bg-surface-muted");
    for (const status of ALL_STATUSES) {
      expect(html).toContain(TITLE_STATUS_LABELS[status]);
    }
  });

  it("leaves missing artwork as an honest empty, not a fake poster", async () => {
    stubClient([titleRow("draft", 0)]);
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);

    const html = await renderCatalog();

    expect(html).toContain("data-titles-catalog-empty-art");
    expect(html).not.toContain("t-data select-none text-3xl");
  });

  it("hides Add Title when the viewer cannot operate", async () => {
    stubClient([titleRow("live", 0)]);
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ canOperate: false }) as never);

    const html = await renderCatalog();

    expect(html).toContain("live film");
    expect(html).toContain(TITLE_STATUS_LABELS.live);
    expect(html).toContain("Search titles");
    expect(html).toContain("data-titles-catalog-status");
    expect(html).not.toContain("data-add-title");
    expect(html).not.toContain(TITLES_CATALOG.addTitle);
  });

  it("does not split drafts onto another nav item", () => {
    const titleItems = NAV.filter((item) => item.href === "/titles" || /draft/i.test(item.label));
    expect(titleItems).toEqual([expect.objectContaining({ label: "Titles", href: "/titles" })]);
    expect(NAV.some((item) => item.href === "/deliveries" && /draft|title/i.test(item.label))).toBe(
      false,
    );
  });

  it("sends a user with no active org home, not to a second catalog", async () => {
    stubClient([]);
    vi.mocked(getOrgContext).mockResolvedValue(ctx({ hasOrg: false, isGcStaff: true }) as never);
    await expect(renderCatalog()).rejects.toThrow("REDIRECT:/");
  });

  it("sends an unauthenticated visitor to login", async () => {
    stubClient([]);
    vi.mocked(getOrgContext).mockResolvedValue(null as never);
    await expect(renderCatalog()).rejects.toThrow("REDIRECT:/login");
  });
});
