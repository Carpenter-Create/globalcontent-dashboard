import { redirect } from "next/navigation";
import { Clapperboard } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { DataTable, type Column } from "@/components/layout/data-table";
import { BannerCard } from "@/components/layout/banner-card";
import { ViewToggle } from "@/components/layout/view-toggle";
import { EmptyState } from "@/components/layout/empty-state";
import { Artwork } from "@/components/layout/artwork";
import { SearchField } from "@/components/layout/search-field";
import { SortControl } from "@/components/layout/sort-control";
import { AddTitleButton } from "./add-title-button";
import { titleArtworkUrls } from "@/lib/artwork";
import { parseSort, parseView, sortRows, nextSort, buildQuery, type SortDir } from "@/lib/catalog-view";
import { filterTitles, type BrowseTitle } from "@/lib/titles-browse";
import { formatReleaseDate } from "@/lib/releases";

// The catalog (§11) as the Visual register: a clean streaming grid of landscape covers
// (search + sort) ⇄ dense operational table. RLS-scoped to the active org. `catalog_id`
// is a GC-only column — never shown on this client surface.
//
// Statuses are intentionally not surfaced here (the status filter, per-card chips, and
// cinematic hero were removed as noise for viewers). The underlying components
// (StatusChip, StatusFilter, SpotlightBanner) and helpers (groupIntoRails, filterByStatus)
// remain in the tree for future use — this page simply no longer renders them.

const ALLOWED_SORTS = ["title", "live", "release", "catalog", "created"] as const;
const DEFAULT_DIR: Record<string, SortDir> = {
  title: "asc",
  catalog: "asc",
  live: "desc",
  release: "desc",
  created: "desc",
};

// Browse-grid sort pills. Each maps to a (key, dir) the shared sorter understands; the
// "recent" default carries no params so the canonical URL stays clean.
const BROWSE_SORTS: { id: string; label: string; key: string; dir: SortDir }[] = [
  { id: "recent", label: "Recently added", key: "created", dir: "desc" },
  { id: "release", label: "Release date", key: "release", dir: "desc" },
  { id: "title", label: "A–Z", key: "title", dir: "asc" },
];

function sortValue(key: string, r: BrowseTitle): string | number | null {
  switch (key) {
    case "title":
      return r.title.toLowerCase();
    case "live":
      return r.live;
    case "release":
      return r.release_date;
    case "catalog":
      return null; // GC-only; not sortable on the client surface
    default:
      return r.created_at;
  }
}

export default async function TitlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const view = parseView(str(sp.view), "browse");
  const q = (str(sp.q) ?? "").slice(0, 100);
  const sort = parseSort(str(sp.sort), str(sp.dir), ALLOWED_SORTS, { key: "created", dir: "desc" });

  const supabase = await createClient();
  // Shared with the layout via React cache() — no second identity check, no second
  // memberships query. Free here because the layout already resolved it this request.
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrg) redirect("/");
  const activeOrg = ctx.activeOrg;
  const canOperate = ctx.canOperate;

  const { data: titles } = await supabase
    .from("titles")
    .select("id, title, status, created_at, catalog_id, release_date")
    .eq("org_id", activeOrg.id)
    .order("created_at", { ascending: false });
  const list = titles ?? [];
  const ids = list.map((t) => t.id);

  const { data: dlv } = ids.length
    ? await supabase.from("deliveries").select("title_id, status").in("title_id", ids)
    : { data: [] as { title_id: string; status: string }[] };
  const counts = new Map<string, { live: number; total: number }>();
  for (const d of dlv ?? []) {
    const c = counts.get(d.title_id) ?? { live: 0, total: 0 };
    c.total += 1;
    if (d.status === "live") c.live += 1;
    counts.set(d.title_id, c);
  }

  const posters = await titleArtworkUrls(supabase, ids);

  const all: BrowseTitle[] = list.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    created_at: t.created_at,
    release_date: t.release_date,
    live: counts.get(t.id)?.live ?? 0,
    total: counts.get(t.id)?.total ?? 0,
    posterUrl: posters.get(t.id)?.poster ?? null,
    bannerUrl: posters.get(t.id)?.banner ?? null,
  }));

  const searching = q.trim().length > 0;
  const filtered = filterTitles(all, q);
  const sorted = sortRows(filtered, (r) => sortValue(sort.key, r), sort.dir);

  const activeSortId = BROWSE_SORTS.find((s) => s.key === sort.key && s.dir === sort.dir)?.id ?? "recent";

  // Shared param bag so every control preserves the others (view / q / sort).
  const baseParams: Record<string, string | undefined> = {
    ...(searching ? { q: q.trim() } : {}),
    ...(sort.key === "created" && sort.dir === "desc" ? {} : { sort: sort.key, dir: sort.dir }),
  };
  const href = (override: Record<string, string | undefined>) =>
    buildQuery({ ...baseParams, ...override });
  const browseHref = href({ view: undefined });
  const tableHref = href({ view: "table" });
  const sortHref = (key: string) => {
    const ns = nextSort(sort, key, DEFAULT_DIR[key] ?? "asc");
    return href({ view: view === "table" ? "table" : undefined, sort: ns.key, dir: ns.dir });
  };
  // Browse sort pills stay in browse view; the default carries no params for a clean URL.
  const sortControlHref = (id: string) => {
    const s = BROWSE_SORTS.find((x) => x.id === id)!;
    const isDefault = s.key === "created" && s.dir === "desc";
    return href({ sort: isDefault ? undefined : s.key, dir: isDefault ? undefined : s.dir });
  };

  const columns: Column<BrowseTitle>[] = [
    {
      key: "poster",
      header: "",
      width: "w-14",
      cell: (r) => <Artwork src={r.posterUrl} title={r.title} className="h-12 w-8" rounded="rounded-[4px]" sizes="32px" />,
    },
    {
      key: "title",
      header: "Title",
      sortable: true,
      cell: (r) => <span className="font-medium text-ink">{r.title}</span>,
    },
    // GC-only: internal cataloging/accounting reference, never shown to clients.
    {
      key: "catalog",
      header: "Catalog ID",
      sortable: true,
      gcOnly: true,
      cell: () => <span className="text-ink-3">—</span>,
    },
    {
      key: "live",
      header: "Live",
      sortable: true,
      align: "right",
      width: "w-24",
      cell: (r) =>
        r.total > 0 ? (
          <span>
            <span className="text-ink">{r.live}</span>
            <span className="text-ink-3">/{r.total}</span>
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: "release",
      header: "Next release",
      sortable: true,
      align: "right",
      width: "w-40",
      cell: (r) => <span className="text-ink-2">{formatReleaseDate(r.release_date)}</span>,
    },
  ];

  const bannerGrid = (items: BrowseTitle[]) => (
    <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((r) => (
        <BannerCard
          key={r.id}
          href={`/titles/${r.id}`}
          title={r.title}
          bannerUrl={r.bannerUrl}
          meta={r.release_date ? formatReleaseDate(r.release_date) : undefined}
        />
      ))}
    </div>
  );

  return (
    <div className="mx-auto w-full px-6 pb-4 pt-8" style={{ maxWidth: "var(--page-max-width)" }}>
      {/* Clean text header — no cinematic hero. */}
      <div className="flex flex-col gap-2 pb-8">
        <span className="t-label text-accent">Catalog</span>
        <h1 className="t-statement text-ink">Titles</h1>
        <p className="t-body text-ink-2">
          {all.length} {all.length === 1 ? "title" : "titles"} in {activeOrg.name}&rsquo;s catalog.
        </p>
      </div>

      {/* Controls — sort left (browse only); search / view / add right. */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-6">
        {list.length > 0 && view === "browse" ? (
          <SortControl current={activeSortId} options={BROWSE_SORTS} hrefFor={sortControlHref} />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {list.length > 0 ? <SearchField /> : null}
          {list.length > 0 ? (
            <ViewToggle current={view} gridHref={browseHref} tableHref={tableHref} />
          ) : null}
          {canOperate ? <AddTitleButton orgId={activeOrg.id} /> : null}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="No titles yet"
          description={
            canOperate
              ? "Add your first title to begin building your catalog."
              : "Titles will appear here once they're added."
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title={`No titles match “${q.trim()}”`}
          description="Try a different search."
        />
      ) : view === "table" ? (
        <DataTable
          columns={columns}
          rows={sorted}
          rowKey={(r) => r.id}
          sort={sort}
          sortHref={sortHref}
          rowHref={(r) => `/titles/${r.id}`}
          isGc={false}
        />
      ) : (
        bannerGrid(sorted)
      )}
    </div>
  );
}
