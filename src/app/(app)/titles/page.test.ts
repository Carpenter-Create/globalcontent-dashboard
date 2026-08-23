import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { titleArtworkUrls } from "@/lib/artwork";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { LIST_PAGE } from "@/lib/list-bounds";
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
vi.mock("next/image", () => ({
  default: ({ src, className }: { src: string; className?: string }) =>
    createElement("img", { src, className, alt: "" }),
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

function titleRow(
  status: TitleStatus,
  i: number,
  extras: { release_date?: string | null; created_at?: string; title?: string; id?: string } = {},
) {
  return {
    id: extras.id ?? `title-${status}`,
    title: extras.title ?? `${status} film`,
    status,
    created_at: extras.created_at ?? `2026-08-${String(10 + i).padStart(2, "0")}T00:00:00Z`,
    catalog_id: `GC-${i}`,
    release_date: extras.release_date === undefined ? null : extras.release_date,
  };
}

function stubClient(
  titles: ReturnType<typeof titleRow>[] = ALL_STATUSES.map((status, i) => titleRow(status, i)),
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

/** Full opening tag that carries `marker` — not the leftover attrs after it. */
function openingTagsWith(html: string, marker: string): string[] {
  const tags: string[] = [];
  let from = 0;
  while (true) {
    const at = html.indexOf(marker, from);
    if (at === -1) break;
    const start = html.lastIndexOf("<", at);
    const end = html.indexOf(">", at);
    if (start === -1 || end === -1) break;
    tags.push(html.slice(start, end + 1));
    from = end + 1;
  }
  return tags;
}

describe("client /titles catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(titleArtworkUrls).mockResolvedValue(new Map());
  });

  it("lists every lifecycle state on one catalog page", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);

    const html = await renderCatalog();

    expect(html).toContain("data-titles-catalog");
    expect(html).toContain("data-titles-catalog-grid");
    expect(html).toContain("data-titles-catalog-card");
    expect(html).toContain("hidden gap-x-[var(--space-8)]");
    expect(html).toContain("xl:grid-cols-5");
    expect(html).toContain("gap-x-[var(--space-8)]");
    expect(html).toContain("gap-y-[var(--space-16)]");
    expect(html).toContain("aspect-[2/3]");
    expect(html).toContain("rounded-[var(--radius-lg)]");
    expect(html).toContain("data-titles-catalog-crop=\"cover\"");
    expect(html).toContain("[&amp;_img]:object-cover");
    expect(html).toContain("[&amp;_img]:object-center");
    expect(html).toContain("data-titles-catalog-stack");
    expect(html).not.toMatch(/[^:]grid-cols-5/);
    expect(html).not.toContain("grid-cols-6");
    expect(html).not.toContain("lg:grid-cols-3");
    expect(html).not.toContain("aspect-[16/9]");
    expect(html).not.toContain("Recently added");
    expect(html).not.toContain("Spotlight");
    expect(html).not.toContain("In progress");
    expect(html).not.toMatch(/\bUpcoming\b/);
    expect(html).not.toContain("FIXTURE");
    expect(html).not.toContain("Meridian");
    expect(html).not.toMatch(/hover:scale|group-hover:scale/);
    expect(html).not.toContain("grid-cols-6");
    expect(html).not.toContain("grid-cols-1");
    expect(html).not.toContain("sm:grid-cols-2");
    expect(html).toContain("md:grid-cols-3");
    expect(html).toContain("lg:grid-cols-4");
    expect(html).toContain("xl:grid-cols-5");

    const cards = html.match(/data-titles-catalog-card=""/g) ?? [];
    expect(cards).toHaveLength(ALL_STATUSES.length);
    expect(html).toMatch(
      /data-titles-catalog-card[\s\S]*data-titles-catalog-frame[\s\S]*data-titles-catalog-status/,
    );

    const statusLabels = [...html.matchAll(/data-titles-catalog-status="">([^<]*)/g)].map(
      (match) => match[1],
    );
    expect(statusLabels).toEqual(ALL_STATUSES.map((status) => TITLE_STATUS_LABELS[status]));
    expect(new Set(statusLabels).size).toBe(6);
    expect(statusLabels.filter((label) => label === "Submitted")).toHaveLength(2);
    expect(statusLabels).not.toContain("Delivered");
    expect(statusLabels).not.toContain("delivered");

    for (const status of ALL_STATUSES) {
      expect(html).toContain(`${status} film`);
      expect(html).toContain(`/titles/title-${status}`);
      expect(html).toContain(`data-title-status="${status}"`);
      expect(html).toContain(TITLE_STATUS_LABELS[status]);
    }
  });

  it("puts Titles, catalog count, search, and Add Title on the Version 24 header row", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);

    const html = await renderCatalog();

    expect(html).toContain(
      "titles-catalog-header flex items-center justify-between gap-[var(--space-2)] md:items-start md:gap-[var(--space-6)]",
    );
    expect(html).not.toContain("titles-catalog-header flex flex-col gap-[var(--space-8)]");
    expect(html).toContain("data-titles-catalog-operate");
    expect(html).toContain(
      "titles-catalog-operate flex shrink-0 items-center gap-[var(--space-4)]",
    );
    expect(html).not.toContain(
      "titles-catalog-operate flex w-full items-center justify-between",
    );
    expect(html).toContain(
      "titles-catalog mx-auto flex w-full flex-col px-[var(--space-4)]",
    );
    expect(html).toContain("md:gap-[var(--space-8)]");
    expect(html).not.toContain(
      "titles-catalog mx-auto flex w-full flex-col gap-[var(--space-10)]",
    );
    expect(html).toMatch(/<h1 class="t-section text-ink max-md:hidden">Titles<\/h1>/);
    expect(html).not.toMatch(/<h1[^>]*t-display/);
    expect(html).not.toMatch(/<h1[^>]*t-title/);
    expect(html).toContain("data-titles-catalog-count");
    expect(html).toContain(`${ALL_STATUSES.length} in catalog`);
    expect(html).not.toContain("10 in catalog");

    const titleClose = html.indexOf("</h1>");
    const countAt = html.indexOf("data-titles-catalog-count");
    const operateAt = html.indexOf("data-titles-catalog-operate");
    const searchAt = html.indexOf("Search titles...");
    const addAt = html.indexOf("data-add-title");
    expect(titleClose).toBeGreaterThan(-1);
    expect(countAt).toBeGreaterThan(titleClose);
    expect(operateAt).toBeGreaterThan(-1);
    expect(searchAt).toBeGreaterThan(operateAt);
    expect(addAt).toBeGreaterThan(operateAt);

    const operateChunk = html.slice(operateAt);
    expect(operateChunk).toContain("Search titles...");
    expect(operateChunk).toContain(TITLES_CATALOG.addTitle);
    expect(operateChunk).toContain("data-add-title");
    expect(operateChunk).not.toContain("data-titles-catalog-count");
  });

  it("keeps search, Add Title, and quiet TITLE_STATUS_LABELS pills — no SaaS subtitle", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);

    const html = await renderCatalog();

    expect(html).toContain(TITLES_CATALOG.title);
    expect(html).toContain("Search titles...");
    expect(html).toContain(TITLES_CATALOG.searchPlaceholder);
    expect(html).toContain(TITLES_CATALOG.addTitle);
    expect(html).toContain("data-add-title");
    const add = openingTagsWith(html, 'data-add-title=""');
    expect(add).toHaveLength(1);
    expect(add[0]).toContain("t-body-sm");
    expect(add[0]).toContain("text-accent");
    expect(add[0]).not.toContain("bg-accent");
    expect(add[0]).not.toContain("max-md:text-accent");
    expect(add[0]).not.toContain("rounded-full");
    expect(html).not.toContain("titles in Acme");
    expect(html).not.toContain("in Acme's catalog");
    expect(html).not.toMatch(/t-label[^>]*data-titles-catalog-status/);
    expect(html).not.toMatch(/genre/i);
    expect(html).not.toMatch(/director/i);

    const statusPills = openingTagsWith(html, 'data-titles-catalog-status=""');
    expect(statusPills).toHaveLength(ALL_STATUSES.length);
    for (const open of statusPills) {
      expect(open).toContain("rounded-full");
      expect(open).toContain("border-hairline");
      expect(open).toContain("t-body-sm font-normal text-ink-2");
      expect(open).not.toContain("bg-surface-muted");
      expect(open).not.toContain("bg-accent");
    }
    expect(html).toContain("t-body-sm font-medium text-ink");
    expect(html).not.toContain("t-heading text-ink");
    expect(html).not.toContain("rounded-full bg-surface-muted");
    expect(html).not.toMatch(/data-titles-catalog-card[\s\S]*t-section/);
    expect(html).not.toMatch(/data-titles-catalog-card[\s\S]*t-display/);
    expect(html).not.toMatch(/data-titles-catalog-card[\s\S]*t-title/);
    expect(html).not.toMatch(/data-titles-catalog-stack[\s\S]*t-body font-medium/);
    expect(html).not.toContain("group-hover:text-ink-2");
    for (const status of ALL_STATUSES) {
      expect(html).toContain(TITLE_STATUS_LABELS[status]);
    }
  });

  it("shows the release_date year under a poster and omits it when unset", async () => {
    stubClient([
      titleRow("live", 0, {
        title: "Dated film",
        release_date: "2019-05-01",
        created_at: "2026-08-10T00:00:00Z",
      }),
      titleRow("draft", 1, {
        title: "Undated film",
        release_date: null,
        created_at: "2026-08-11T00:00:00Z",
      }),
    ]);
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);

    const html = await renderCatalog();

    expect(html).toContain("Dated film");
    expect(html).toContain("data-titles-catalog-card");
    expect(html).toContain("data-titles-catalog-year");
    expect(html).toContain("2019");
    const yearTag = openingTagsWith(html, 'data-titles-catalog-year=""');
    expect(yearTag).toHaveLength(1);
    expect(yearTag[0]).toContain("t-body-sm font-normal text-ink-3");
    expect(html).toContain("Undated film");
    expect(html).not.toContain("—");
    expect(html).not.toContain("2026-08-10");
    expect(html).not.toContain("2026-08-11");
    expect(html).not.toMatch(/genre/i);
    const years = html.match(/data-titles-catalog-year=""/g) ?? [];
    expect(years).toHaveLength(1);
    expect(html).toMatch(
      /data-titles-catalog-card[\s\S]*Dated film[\s\S]*data-titles-catalog-year[\s\S]*2019[\s\S]*data-titles-catalog-status/,
    );
    const gridAt = html.indexOf("data-titles-catalog-grid");
    const undatedCard = html.slice(html.indexOf("Undated film", gridAt));
    expect(undatedCard.slice(0, undatedCard.indexOf("data-titles-catalog-status"))).not.toContain(
      "data-titles-catalog-year",
    );
    expect(html.match(/data-titles-catalog-rail-year=""/g) ?? []).toHaveLength(1);
  });

  it("reads each title as a full-bleed still with type in air — no boxed card", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);

    const html = await renderCatalog();
    const cards = openingTagsWith(html, 'data-titles-catalog-card=""');
    const frames = openingTagsWith(html, 'data-titles-catalog-frame=""');
    const stacks = openingTagsWith(html, 'data-titles-catalog-stack=""');
    expect(cards).toHaveLength(ALL_STATUSES.length);
    expect(frames).toHaveLength(ALL_STATUSES.length);
    expect(stacks).toHaveLength(ALL_STATUSES.length);
    for (const open of cards) {
      expect(open).toContain("data-titles-catalog-card");
      expect(open).not.toContain("border-hairline");
      expect(open).not.toContain("bg-surface");
      expect(open).not.toContain("overflow-hidden");
    }
    for (const open of frames) {
      expect(open).toContain("rounded-[var(--radius-lg)]");
    }
    for (const open of stacks) {
      expect(open).not.toContain("px-[var(--space-4)]");
      expect(open).not.toContain("pb-[var(--space-4)]");
    }
    expect(html).not.toContain("bg-gradient");
    expect(html).not.toContain("from-accent");
  });

  it("applies the same 2:3 cover crop to every catalog still", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);

    const html = await renderCatalog();
    const frames = openingTagsWith(html, 'data-titles-catalog-frame=""');
    expect(frames).toHaveLength(ALL_STATUSES.length);
    for (const open of frames) {
      expect(open).toContain("data-titles-catalog-frame");
      expect(open).toContain('data-titles-catalog-crop="cover"');
      expect(open).toContain("aspect-[2/3]");
      expect(open).toContain("[&amp;_img]:object-cover");
      expect(open).toContain("[&amp;_img]:object-center");
      expect(open).not.toContain("aspect-[16/9]");
      expect(open).not.toContain("object-contain");
    }
  });

  it("keeps title small and year plus TITLE_STATUS_LABELS on one meta line", async () => {
    stubClient([
      titleRow("live", 0, { title: "Stacked film", release_date: "2019-05-01" }),
    ]);
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);

    const html = await renderCatalog();
    const name = openingTagsWith(html, 'data-titles-catalog-name=""');
    const meta = openingTagsWith(html, 'data-titles-catalog-meta=""');
    expect(name).toHaveLength(1);
    expect(name[0]).toContain("t-body-sm font-medium text-ink");
    expect(name[0]).not.toContain("t-heading");
    expect(meta).toHaveLength(1);
    expect(meta[0]).toContain("flex min-w-0 flex-wrap items-center");
    expect(html).toMatch(
      /data-titles-catalog-name[\s\S]*Stacked film[\s\S]*data-titles-catalog-meta[\s\S]*data-titles-catalog-year[\s\S]*2019[\s\S]*data-titles-catalog-status[\s\S]*Live/,
    );
    expect(html).toContain("gap-[var(--space-1)]");
    expect(html).not.toContain("Delivered");
    expect(html).not.toContain("delivered");
  });

  it("prefers poster then banner and keeps the same cover crop on both", async () => {
    stubClient([
      titleRow("draft", 0, { title: "Poster title" }),
      titleRow("live", 1, { title: "Banner title" }),
    ]);
    vi.mocked(titleArtworkUrls).mockResolvedValue(
      new Map([
        ["title-draft", { poster: "https://cdn/poster.jpg", banner: "https://cdn/wide.jpg" }],
        ["title-live", { poster: null, banner: "https://cdn/wide.jpg" }],
      ]),
    );
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);

    const html = await renderCatalog();

    expect(html).toContain("https://cdn/poster.jpg");
    expect(html).toContain("https://cdn/wide.jpg");
    expect(html).not.toContain("data-titles-catalog-empty-art");
    const frames = openingTagsWith(html, 'data-titles-catalog-frame=""');
    expect(frames).toHaveLength(2);
    for (const open of frames) {
      expect(open).toContain('data-titles-catalog-crop="cover"');
      expect(open).toContain("aspect-[2/3]");
      expect(open).toContain("[&amp;_img]:object-cover");
      expect(open).toContain("[&amp;_img]:object-center");
    }
  });

  it("leaves missing artwork as an honest empty, not a fake poster", async () => {
    stubClient([titleRow("draft", 0)]);
    vi.mocked(titleArtworkUrls).mockResolvedValue(new Map());
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);

    const html = await renderCatalog();

    expect(html).toContain("data-titles-catalog-empty-art");
    expect(html).not.toContain("t-data select-none text-3xl");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('rel="preload"');
    expect(html).not.toContain("poster.jpg");
    expect(html).not.toContain("https://cdn/");
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

  it("names the real catalog count and marks a bounded read as a floor", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    const exact = await renderCatalog();
    expect(exact).toContain(`${ALL_STATUSES.length} in catalog`);
    expect(exact).not.toContain("10 in catalog");
    expect(exact).not.toContain(`${ALL_STATUSES.length}+ in catalog`);

    const bounded = Array.from({ length: LIST_PAGE + 1 }, (_, i) =>
      titleRow("draft", i, { id: `title-draft-${i}`, title: `Bounded film ${i}` }),
    );
    stubClient(bounded);
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    const html = await renderCatalog();
    expect(html).toContain(`${LIST_PAGE}+ in catalog`);
    expect(html).not.toContain(`${LIST_PAGE + 1} in catalog`);
    expect(html).not.toContain("10 in catalog");
    expect(html).toContain(`more than ${LIST_PAGE} titles`);
  });

  it("keeps search on the catalog page, not in the global header", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    const html = await renderCatalog();

    expect(html).toContain('placeholder="Search titles..."');
    expect(html).toContain("data-titles-catalog-operate");
    const operate = html.slice(html.indexOf("data-titles-catalog-operate"));
    expect(operate).toContain("Search titles...");
    expect(operate).toContain("max-md:hidden");
    expect(html).not.toContain("⌘K");
    expect(html).not.toContain("CommandK");
  });

  it("does not scale posters or invent fixture catalog chrome", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    const html = await renderCatalog();
    const cards = openingTagsWith(html, 'data-titles-catalog-card=""');
    const frames = openingTagsWith(html, 'data-titles-catalog-frame=""');
    for (const open of [...cards, ...frames]) {
      expect(open).not.toMatch(/hover:scale|group-hover:scale|scale-/);
    }
    expect(html).not.toContain("FIXTURE");
    expect(html).not.toContain("Meridian");
    expect(html).not.toContain("The Cartographer");
    expect(html).not.toMatch(/hover:scale|group-hover:scale/);
  });

  it("locks mobile 528:542 to one Recent snap rail and 13 Sporty Blue Add Title", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    const html = await renderCatalog();
    const rail = openingTagsWith(html, 'data-titles-catalog-rail=""');
    const cards = openingTagsWith(html, 'data-titles-catalog-rail-card=""');
    const frames = openingTagsWith(html, 'data-titles-catalog-rail-frame=""');
    const add = openingTagsWith(html, 'data-add-title=""');

    expect(html).toContain("data-titles-catalog-identity");
    expect(html).toContain("Acme");
    expect(html).toContain(TITLES_CATALOG.recent);
    expect(rail).toHaveLength(1);
    expect(cards).toHaveLength(ALL_STATUSES.length);
    expect(frames).toHaveLength(ALL_STATUSES.length);
    const tracks = openingTagsWith(html, 'data-titles-catalog-rail-track=""');
    expect(html).toContain("snap-x");
    expect(html).toContain("w-[140px]");
    expect(html).toContain("h-[210px]");
    expect(html).toContain("rounded-[12px]");
    expect(html).toContain("gap-[var(--space-4)]");
    expect(html).toContain(
      "titles-catalog mx-auto flex w-full flex-col px-[var(--space-4)]",
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toContain("gap-[var(--space-4)]");
    expect(tracks[0]).not.toContain("-mx-[var(--space-4)]");
    expect(tracks[0]).not.toContain("px-[var(--space-4)]");
    expect(add).toHaveLength(1);
    expect(add[0]).toContain("t-body-sm");
    expect(add[0]).toContain("text-accent");
    expect(add[0]).not.toContain("bg-accent");
    expect(add[0]).not.toContain("max-md:text-accent");
    expect(add[0]).not.toContain("max-md:bg-transparent");
    expect(html).toContain("max-md:hidden");
    expect(html).not.toContain("Recently added");
    expect(html).not.toContain("Store");
    expect(html).not.toContain("Apple TV");
    expect(html).not.toContain("bg-band");
    expect(html).not.toMatch(/\bStore\b/);
    expect(html.match(/data-titles-catalog-rail=""/g) ?? []).toHaveLength(1);
    expect(html).not.toContain("data-titles-catalog-rail-2");
  });

  it("locks empty 529:542 to The catalog is empty. plus Add Title text", async () => {
    stubClient([]);
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    const html = await renderCatalog();
    const add = openingTagsWith(html, 'data-add-title=""');

    expect(html).toContain(TITLES_CATALOG.emptyCatalog);
    expect(html).toContain("The catalog is empty.");
    expect(html.split("The catalog is empty.").length - 1).toBe(1);
    expect(html).toContain("Acme");
    expect(html).toContain(TITLES_CATALOG.addTitle);
    expect(add).toHaveLength(1);
    expect(add[0]).toContain("t-body-sm");
    expect(add[0]).toContain("text-accent");
    expect(add[0]).not.toContain("bg-accent");
    expect(add[0]).not.toContain("max-md:text-accent");
    expect(add[0]).not.toContain("max-md:bg-transparent");
    expect(html).toContain(TITLES_CATALOG.emptyCanOperate);
    expect(html).not.toContain("data-titles-catalog-rail");
    expect(html).not.toContain("Store");
    expect(html).not.toContain("Recent");
    expect(html).not.toContain("Meridian Pictures");
  });

  it("locks desktop header Add Title as 13 Sporty Blue text and keeps the 1:3 grid", async () => {
    stubClient();
    vi.mocked(getOrgContext).mockResolvedValue(ctx() as never);
    const html = await renderCatalog();
    const add = openingTagsWith(html, 'data-add-title=""');

    expect(add).toHaveLength(1);
    expect(add[0]).toContain("t-body-sm");
    expect(add[0]).toContain("text-accent");
    expect(add[0]).not.toContain("bg-accent");
    expect(add[0]).not.toContain("max-md:text-accent");
    expect(add[0]).not.toContain("max-md:bg-transparent");
    expect(add[0]).not.toContain("rounded-full");
    expect(add[0]).not.toContain("px-[var(--space-6)]");
    expect(html).toContain("data-titles-catalog-grid");
    expect(html).toContain("md:grid-cols-3");
    expect(html).toContain("lg:grid-cols-4");
    expect(html).toContain("xl:grid-cols-5");
    expect(html).toContain("hidden gap-x-[var(--space-8)]");
  });
});
