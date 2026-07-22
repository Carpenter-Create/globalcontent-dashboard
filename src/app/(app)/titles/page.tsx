import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Clapperboard } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { DataTable, type Column } from "@/components/layout/data-table";
import { BannerCard } from "@/components/layout/banner-card";
import { ViewToggle } from "@/components/layout/view-toggle";
import { StatusChip } from "@/components/layout/status-chip";
import { EmptyState } from "@/components/layout/empty-state";
import { Artwork } from "@/components/layout/artwork";
import { Rail } from "@/components/layout/rail";
import { SpotlightBanner } from "@/components/layout/spotlight-banner";
import { SearchField } from "@/components/layout/search-field";
import { StatusFilter } from "@/components/layout/status-filter";
import { AddTitleButton } from "./add-title-button";
import { titleArtworkUrls } from "@/lib/artwork";
import { parseSort, parseView, sortRows, nextSort, buildQuery, type SortDir } from "@/lib/catalog-view";
import {
  filterTitles,
  groupIntoRails,
  spotlightTitle,
  filterByStatus,
  parseStatusFilter,
  CATALOG_STATUS_FILTERS,
  type BrowseTitle,
} from "@/lib/titles-browse";
import { TITLE_STATUS_LABELS } from "@/lib/titles";
import { formatReleaseDate } from "@/lib/releases";

// The catalog (§11) as the Visual register: streaming browse (spotlight + poster rails
// + search) ⇄ dense operational table. RLS-scoped to the active org. `catalog_id` is a
// GC-only column — never shown on this client surface.

const ALLOWED_SORTS = ["title", "status", "live", "release", "catalog", "created"] as const;
const DEFAULT_DIR: Record<string, SortDir> = {
  title: "asc",
  status: "asc",
  catalog: "asc",
  live: "desc",
  release: "desc",
  created: "desc",
};

function sortValue(key: string, r: BrowseTitle): string | number | null {
  switch (key) {
    case "title":
      return r.title.toLowerCase();
    case "status":
      return TITLE_STATUS_LABELS[r.status];
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

function statusChipFor(r: BrowseTitle): { label: string; tone: "neutral" | "active" | "muted" } {
  if (r.live > 0) return { label: "Live", tone: "active" };
  return {
    label: TITLE_STATUS_LABELS[r.status],
    tone: r.status === "draft" ? "muted" : "neutral",
  };
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
  const status = parseStatusFilter(str(sp.status));
  const sort = parseSort(str(sp.sort), str(sp.dir), ALLOWED_SORTS, { key: "created", dir: "desc" });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("memberships")
    .select("role, organizations(id, name)")
    .eq("user_id", user.id)
    .eq("status", "active");
  const rows = (memberships ?? []).filter((m) => m.organizations);
  const cookieOrg = (await cookies()).get("gc_active_org")?.value ?? null;
  const activeRow = rows.find((m) => m.organizations!.id === cookieOrg) ?? rows[0] ?? null;
  if (!activeRow) redirect("/");
  const activeOrg = activeRow.organizations!;
  const canOperate = activeRow.role === "account_owner" || activeRow.role === "delivery_ops";

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

  const now = new Date();
  const filtered = filterTitles(filterByStatus(all, status, now), q);
  const searching = q.trim().length > 0;
  const filtering = searching || status !== "all"; // → show a flat grid, not the rails

  // Shared param bag so every control preserves the others (view/q/status/sort).
  const baseParams: Record<string, string | undefined> = {
    ...(searching ? { q: q.trim() } : {}),
    ...(status !== "all" ? { status } : {}),
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
  const statusHref = (key: string) =>
    href({ view: view === "table" ? "table" : undefined, status: key === "all" ? undefined : key });

  const columns: Column<BrowseTitle>[] = [
    {
      key: "poster",
      header: "",
      width: "w-14",
      cell: (r) => <Artwork src={r.posterUrl} title={r.title} className="h-12 w-8" rounded="rounded-[4px]" />,
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
      key: "status",
      header: "Status",
      sortable: true,
      cell: (r) => {
        const s = statusChipFor(r);
        return <StatusChip label={s.label} tone={s.tone} />;
      },
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
    <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((r) => (
        <BannerCard
          key={r.id}
          href={`/titles/${r.id}`}
          title={r.title}
          bannerUrl={r.bannerUrl}
          status={statusChipFor(r)}
          meta={r.release_date ? formatReleaseDate(r.release_date) : undefined}
        />
      ))}
    </div>
  );

  const rails = groupIntoRails(filtered, now);
  const spotlight = spotlightTitle(filtered, now);

  const heroShown = view === "browse" && !filtering && !!spotlight?.bannerUrl;

  return (
    <>
      {/* Full-bleed cinematic hero (Apple-TV register) — the page opts out of the width
          cap in AppShell so this spans the full content width. */}
      {heroShown ? (
        <SpotlightBanner
          href={`/titles/${spotlight!.id}`}
          kicker="Next up"
          title={spotlight!.title}
          bannerUrl={spotlight!.bannerUrl}
          statusLabel={statusChipFor(spotlight!).label}
          active={spotlight!.live > 0}
          meta={spotlight!.release_date ? formatReleaseDate(spotlight!.release_date) : undefined}
        />
      ) : null}

      {/* Everything below the hero lives in a centered, comfortable-width column. */}
      <div
        className={`mx-auto w-full px-6 pb-4 ${heroShown ? "pt-6" : "pt-8"}`}
        style={{ maxWidth: "var(--page-max-width)" }}
      >
        {!heroShown ? (
          <div className="flex flex-col gap-1 pb-6">
            <span className="t-label text-accent">Catalog</span>
            <h1 className="t-subhead text-ink">Titles</h1>
            <p className="t-body-sm text-ink-3">{`${activeOrg.name}'s catalog.`}</p>
          </div>
        ) : null}

        {/* Controls — filters left; search / view / add right */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-6">
          {list.length > 0 ? (
            <StatusFilter current={status} options={CATALOG_STATUS_FILTERS} hrefFor={statusHref} />
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
            title={searching ? `No titles match “${q.trim()}”` : "No titles in this filter"}
            description="Try a different search or filter."
          />
        ) : view === "table" ? (
          <DataTable
            columns={columns}
            rows={sortRows(filtered, (r) => sortValue(sort.key, r), sort.dir)}
            rowKey={(r) => r.id}
            sort={sort}
            sortHref={sortHref}
            rowHref={(r) => `/titles/${r.id}`}
            isGc={false}
          />
        ) : filtering || rails.length <= 1 ? (
          bannerGrid(filtered)
        ) : (
          <div className="flex flex-col gap-8">
            {rails.map((rail) => (
              <Rail key={rail.key} label={rail.label}>
                {rail.rows.map((r) => (
                  <div key={r.id} className="w-60 shrink-0 snap-start sm:w-72">
                    <BannerCard
                      href={`/titles/${r.id}`}
                      title={r.title}
                      bannerUrl={r.bannerUrl}
                      status={statusChipFor(r)}
                    />
                  </div>
                ))}
              </Rail>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
