import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/supabase/context";
import { LIST_PAGE, probeRange, splitProbe } from "@/lib/list-bounds";
import { InlineNotice } from "@/components/ui/inline-notice";
import { SearchField } from "@/components/layout/search-field";
import { AddTitleButton } from "./add-title-button";
import { titleArtworkUrls } from "@/lib/artwork";
import { filterTitles, type BrowseTitle } from "@/lib/titles-browse";
import {
  TITLES_CATALOG,
  catalogCountLabel,
  catalogReleaseYear,
  catalogStatusMark,
  catalogStillSrc,
} from "@/lib/titles-catalog";
import {
  TitlesCatalogEmpty,
  TitlesCatalogFrame,
  TitlesCatalogGrid,
  TitlesCatalogHeader,
  TitlesCatalogRail,
  TitlesCatalogRailStill,
  TitlesCatalogStill,
} from "@/components/titles/titles-catalog";
import type { TitleStatus } from "@/lib/titles";

// Client `/titles` is the catalog you operate: every title the org owns, every
// existing title.status, on this one page. Desktop 1:3 is the unboxed grid.
// Mobile 528:542 is one Recent snap rail — not a storefront, not Apple TV dark,
// not a second catalog. `catalog_id` stays GC-only.

export default async function TitlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = (str(sp.q) ?? "").slice(0, 100);

  const supabase = await createClient();
  // Shared with the layout via React cache() — no second identity check, no second
  // memberships query. Free here because the layout already resolved it this request.
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrg) redirect("/");
  const activeOrg = ctx.activeOrg;
  const canOperate = ctx.canOperate;

  // BOUNDED (catalog-at-scale spec, phase 1). Unbounded, this returned exactly 1,000 rows
  // at PostgREST's max_rows with no error — a client with 1,200 films could not see 200 of
  // them and nothing said so. Probe fetches one extra row so truncation is detectable
  // without an exact count(*), which is its own cost over an RLS-filtered table.
  // Keyset pagination is phase 2; this makes the limit honest in the meantime.
  const [tFrom, tTo] = probeRange(LIST_PAGE);
  const { data: titlePage } = await supabase
    .from("titles")
    .select("id, title, status, created_at, catalog_id, release_date")
    .eq("org_id", activeOrg.id)
    .order("created_at", { ascending: false })
    .range(tFrom, tTo);
  const { rows: list, truncated } = splitProbe(titlePage, LIST_PAGE);
  const ids = list.map((t) => t.id);
  const posters = await titleArtworkUrls(supabase, ids);

  const all: BrowseTitle[] = list.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    created_at: t.created_at,
    release_date: t.release_date,
    live: 0,
    total: 0,
    posterUrl: posters.get(t.id)?.poster ?? null,
    bannerUrl: posters.get(t.id)?.banner ?? null,
  }));

  const filtered = filterTitles(all, q);

  const stills = filtered.map((r) => ({
    key: r.id,
    href: `/titles/${r.id}`,
    title: r.title,
    stillUrl: catalogStillSrc(r.bannerUrl, r.posterUrl),
    status: r.status,
    statusLabel: catalogStatusMark(r.status as TitleStatus),
    year: catalogReleaseYear(r.release_date),
  }));

  return (
    <TitlesCatalogFrame empty={list.length === 0}>
      <TitlesCatalogHeader
        identity={activeOrg.name}
        count={catalogCountLabel(list.length, truncated)}
        action={
          list.length > 0 || canOperate ? (
            <>
              {list.length > 0 ? (
                <div className="max-md:hidden">
                  <SearchField placeholder={TITLES_CATALOG.searchPlaceholder} />
                </div>
              ) : null}
              {canOperate ? <AddTitleButton orgId={activeOrg.id} /> : null}
            </>
          ) : undefined
        }
      />

      {/* Honest about the bound. Silent truncation is the bug this replaced — a client with
          more titles than the page size could not see them and nothing said so. Paging
          arrives in phase 2 of the catalog-at-scale spec; until then, say it out loud. */}
      {truncated ? (
        <InlineNotice tone="info">
          Your catalog has more than {LIST_PAGE} titles. Search finds anything in the{" "}
          {LIST_PAGE} shown; full browsing of larger catalogs is coming shortly.
        </InlineNotice>
      ) : null}

      {list.length === 0 ? (
        <>
          <TitlesCatalogEmpty className="md:hidden">
            {TITLES_CATALOG.emptyCatalog}
          </TitlesCatalogEmpty>
          <TitlesCatalogEmpty className="max-md:hidden">
            {canOperate ? TITLES_CATALOG.emptyCanOperate : TITLES_CATALOG.emptyReadOnly}
          </TitlesCatalogEmpty>
        </>
      ) : filtered.length === 0 ? (
        <TitlesCatalogEmpty>
          {TITLES_CATALOG.searchMiss(q.trim())} {TITLES_CATALOG.searchMissHint}
        </TitlesCatalogEmpty>
      ) : (
        <>
          <TitlesCatalogRail>
            {stills.map((r) => (
              <TitlesCatalogRailStill
                key={r.key}
                href={r.href}
                title={r.title}
                stillUrl={r.stillUrl}
                status={r.status}
                year={r.year}
              />
            ))}
          </TitlesCatalogRail>
          <TitlesCatalogGrid>
            {stills.map((r) => (
              <TitlesCatalogStill
                key={r.key}
                href={r.href}
                title={r.title}
                stillUrl={r.stillUrl}
                status={r.status}
                statusLabel={r.statusLabel}
                year={r.year}
              />
            ))}
          </TitlesCatalogGrid>
        </>
      )}
    </TitlesCatalogFrame>
  );
}
