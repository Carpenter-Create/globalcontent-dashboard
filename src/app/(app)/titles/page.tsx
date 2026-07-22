import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Clapperboard } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { PageStack, PageSection } from "@/components/layout/page-section";
import { DataTable, type Column } from "@/components/layout/data-table";
import { PosterCard } from "@/components/layout/poster-card";
import { ViewToggle } from "@/components/layout/view-toggle";
import { StatusChip } from "@/components/layout/status-chip";
import { EmptyState } from "@/components/layout/empty-state";
import { Artwork } from "@/components/layout/artwork";
import { titleArtworkUrls } from "@/lib/artwork";
import {
  parseSort,
  parseView,
  sortRows,
  nextSort,
  buildQuery,
  type SortDir,
} from "@/lib/catalog-view";
import { TITLE_STATUS_LABELS, type TitleStatus } from "@/lib/titles";
import { formatReleaseDate } from "@/lib/releases";
import { AddTitleForm } from "./add-title-form";

// The catalog (§11, flat), rebuilt to the layout standard: poster grid ⇄ dense table,
// URL-driven sort, one section grammar. `catalog_id` is GC-only (a `gcOnly` column) so it
// never shows on this client surface. RLS-scoped to the active org.

type Row = {
  id: string;
  title: string;
  status: TitleStatus;
  created_at: string;
  catalog_id: string | null;
  release_date: string | null;
  live: number;
  total: number;
  posterUrl: string | null;
};

const ALLOWED_SORTS = ["title", "status", "live", "release", "catalog", "created"] as const;
const DEFAULT_DIR: Record<string, SortDir> = {
  title: "asc",
  status: "asc",
  catalog: "asc",
  live: "desc",
  release: "desc",
  created: "desc",
};

function sortValue(key: string, r: Row): string | number | null {
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
      return r.catalog_id;
    default:
      return r.created_at;
  }
}

function statusChipFor(r: Row): { label: string; tone: "neutral" | "active" | "muted" } {
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
  const view = parseView(str(sp.view), "grid");
  const sort = parseSort(str(sp.sort), str(sp.dir), ALLOWED_SORTS, {
    key: "created",
    dir: "desc",
  });

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

  const data: Row[] = list.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status as TitleStatus,
    created_at: t.created_at,
    catalog_id: t.catalog_id,
    release_date: t.release_date,
    live: counts.get(t.id)?.live ?? 0,
    total: counts.get(t.id)?.total ?? 0,
    posterUrl: posters.get(t.id) ?? null,
  }));

  const sorted = sortRows(data, (r) => sortValue(sort.key, r), sort.dir);

  const sortParams =
    sort.key === "created" && sort.dir === "desc" ? {} : { sort: sort.key, dir: sort.dir };
  const gridHref = buildQuery({ ...sortParams });
  const tableHref = buildQuery({ view: "table", ...sortParams });
  const sortHref = (key: string) => {
    const ns = nextSort(sort, key, DEFAULT_DIR[key] ?? "asc");
    return buildQuery({ view: "table", sort: ns.key, dir: ns.dir });
  };

  const deliveriesCell = (r: Row) =>
    r.total > 0 ? (
      <span>
        <span className="text-ink">{r.live}</span>
        <span className="text-ink-3">/{r.total}</span>
      </span>
    ) : (
      <span className="text-ink-3">—</span>
    );

  const columns: Column<Row>[] = [
    {
      key: "poster",
      header: "",
      width: "w-14",
      cell: (r) => (
        <Artwork src={r.posterUrl} title={r.title} className="h-12 w-8" rounded="rounded-[4px]" />
      ),
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
      cell: (r) => <span className="tabular-nums text-ink-2">{r.catalog_id ?? "—"}</span>,
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
      cell: deliveriesCell,
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

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Titles"
        subtitle={`${activeOrg.name}'s catalog.`}
        actions={
          list.length > 0 ? (
            <ViewToggle current={view} gridHref={gridHref} tableHref={tableHref} />
          ) : undefined
        }
      />

      <PageStack>
        <PageSection>
          {list.length === 0 ? (
            <EmptyState
              icon={Clapperboard}
              title="No titles yet"
              description={
                canOperate
                  ? "Add your first title below to begin building your catalog."
                  : "Titles will appear here once they're added."
              }
            />
          ) : view === "grid" ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {sorted.map((r) => (
                <PosterCard
                  key={r.id}
                  href={`/titles/${r.id}`}
                  title={r.title}
                  posterUrl={r.posterUrl}
                  status={statusChipFor(r)}
                  meta={r.release_date ? formatReleaseDate(r.release_date) : undefined}
                />
              ))}
            </div>
          ) : (
            <DataTable
              columns={columns}
              rows={sorted}
              rowKey={(r) => r.id}
              sort={sort}
              sortHref={sortHref}
              rowHref={(r) => `/titles/${r.id}`}
              isGc={false}
            />
          )}
        </PageSection>

        {canOperate ? (
          <PageSection title="Add a title" description="Register a new title to start intake.">
            <div className="max-w-xl">
              <AddTitleForm orgId={activeOrg.id} />
            </div>
          </PageSection>
        ) : null}
      </PageStack>
    </>
  );
}
