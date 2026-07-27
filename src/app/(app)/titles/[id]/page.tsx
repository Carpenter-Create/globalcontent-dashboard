import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { Card, CardHeader, CardTitle, CardDescription, CardBody } from "@/components/ui/card";
import { TitleHero } from "@/components/layout/title-hero";
import { FieldList } from "@/components/layout/field-list";
import { StatusChip } from "@/components/layout/status-chip";
import { RIGHTS_META } from "@/lib/rights";
import { describeTerritory } from "@/lib/territories";
import { requiredComplete } from "@/lib/metadata";
import { InlineNotice } from "@/components/ui/inline-notice";
import { FindingsCard } from "@/components/findings/findings-card";
import { titleArtworkUrls } from "@/lib/artwork";
import { screenerKindFor } from "@/lib/assets";
import { RELEASE_TYPE_LABEL, formatReleaseDate, type ReleaseType } from "@/lib/releases";
import { AddRightsForm } from "./add-rights-form";
import { ReleaseInfoForm } from "./release-info-form";
import { AssetUpload } from "./asset-upload";
import { ScreenerSourceControl } from "./screener-source-control";
import { ScreenerWatchButton } from "./screener-watch-button";
import { AssetDownloadButton } from "./asset-download-button";
import { SubmitButton } from "./submit-button";
import { titleDisplayStatus, DELIVERY_STATUS_ROW_LABELS, type TitleStatus } from "@/lib/titles";

const ASSET_KIND_LABELS: Record<"master" | "caption" | "artwork" | "poster" | "banner" | "screener", string> = {
  master: "Master",
  caption: "Caption",
  artwork: "Poster", // legacy generic 'artwork' == the vertical poster (backfilled)
  poster: "Poster",
  banner: "Banner",
  screener: "Screener",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024,
    i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

// Title detail — streaming-title-page × catalog/information-management hybrid: a banner
// hero on top, then the catalog/info as distinct surfaced cards (Mercury register:
// clear panels, headers, hairline dividers, generous rhythm). RLS-scoped; operate-capable
// roles (account_owner, delivery_ops — §4) see the edit forms.
export default async function TitleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const { data: title } = await supabase
    .from("titles")
    .select("id, title, status, org_id, catalog_id, screener_source, release_type, original_release_date, release_date")
    .eq("id", id)
    .maybeSingle();
  if (!title) notFound(); // RLS returns null for another org's title → 404

  const titleRole = rows.find((m) => m.organizations!.id === title.org_id)?.role;
  const canOperate = titleRole === "account_owner" || titleRole === "delivery_ops";

  const { data: grants } = await supabase
    .from("rights_grants")
    .select("id, rights_type, territory_mode, territories, exclusive, window_start, window_end")
    .eq("title_id", id)
    .is("effective_to", null)
    .order("created_at", { ascending: false });
  const list = grants ?? [];

  const { data: assets } = await supabase
    .from("assets")
    .select("id, kind, original_filename, bytes, received_at")
    .eq("title_id", id)
    .order("received_at", { ascending: false });
  const assetList = assets ?? [];

  const { data: metaRow } = await supabase
    .from("title_metadata")
    .select("data")
    .eq("title_id", id)
    .maybeSingle();
  const complete = requiredComplete((metaRow?.data as Record<string, unknown>) ?? {});

  const { data: latestReview } = await supabase
    .from("title_reviews")
    .select("decision, reason, created_at")
    .eq("title_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const showRejection =
    title.status === "draft" && latestReview?.decision === "reject" && !!latestReview.reason;

  const { data: allDlv } = await supabase.rpc("my_deliveries");
  const titleDlv = (allDlv ?? []).filter((d) => d.title_id === id);
  const liveCount = titleDlv.filter((d) => d.status === "live").length;
  const totalCount = titleDlv.length;

  const { data: findings } = await supabase
    .from("findings")
    .select("id, message, severity")
    .eq("entity_type", "title")
    .eq("entity_id", id)
    .eq("status", "open")
    .order("severity", { ascending: true });

  const art = (await titleArtworkUrls(supabase, [id])).get(id) ?? { poster: null, banner: null };

  const statusLabel = titleDisplayStatus(title.status as TitleStatus, liveCount, totalCount);
  const statusTone: "neutral" | "active" | "muted" =
    liveCount > 0 ? "active" : title.status === "draft" ? "muted" : "neutral";

  const heroFacts: { label: string; value: React.ReactNode }[] = [];
  if (title.release_date) heroFacts.push({ label: "Release", value: formatReleaseDate(title.release_date) });
  if (totalCount > 0) heroFacts.push({ label: "Live", value: `${liveCount}/${totalCount}` });

  const canSubmit = canOperate && title.status === "draft";

  // Screener is watchable when its source exists: a dedicated screener asset if the title
  // is set to 'dedicated', else the master. (The stream is signed server-side, RLS-scoped.)
  // Mirror /api/screener/url's split exactly (screenerKindFor is the shared rule): staff may
  // fall back to the master, a client may only ever be served a dedicated screener. Without
  // the staff check this button renders for clients on master-source titles and then 404s.
  const { data: staffRow } = await supabase
    .from("gc_staff")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const screenerKind = screenerKindFor(title.screener_source, Boolean(staffRow));
  const screenerAvailable = screenerKind !== null && assetList.some((a) => a.kind === screenerKind);

  return (
    <>
      <TitleHero
        title={title.title}
        backHref="/titles"
        backLabel="Titles"
        statusLabel={statusLabel}
        active={liveCount > 0}
        posterUrl={art.poster}
        bannerUrl={art.banner}
        facts={heroFacts}
        action={screenerAvailable ? <ScreenerWatchButton titleId={title.id} /> : null}
      />

      <div className="mt-6 flex flex-col gap-6">
        {/* Attention — surfaced only when there's something to act on */}
        {(findings ?? []).length > 0 ? <FindingsCard findings={findings ?? []} /> : null}
        {showRejection ? (
          <InlineNotice tone="error">Returned for revision: {latestReview!.reason}</InlineNotice>
        ) : null}
        {canSubmit ? (
          complete.filled >= complete.total ? (
            <SubmitButton orgId={title.org_id} titleId={title.id} />
          ) : (
            <InlineNotice tone="info">
              Complete the {complete.total} required metadata fields to submit this title for review.{" "}
              <Link href={`/titles/${id}/metadata`} className="text-accent">
                Edit metadata
              </Link>
            </InlineNotice>
          )
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Side rail — compact facts */}
          <div className="flex flex-col gap-6 lg:order-2">
            {/* Overview (folds in metadata completeness + edit link) */}
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Overview</CardTitle>
                <Link href={`/titles/${id}/metadata`} className="t-body-sm text-accent">
                  {canOperate ? "Edit" : "View"}
                </Link>
              </CardHeader>
              <FieldList
                items={[
                  { label: "Status", value: <StatusChip label={statusLabel} tone={statusTone} /> },
                  { label: "Release type", value: RELEASE_TYPE_LABEL[title.release_type as ReleaseType] },
                  { label: "Rights", value: `${list.length} ${list.length === 1 ? "grant" : "grants"}` },
                  { label: "Metadata", value: `${complete.filled} of ${complete.total} complete` },
                  {
                    label: "Catalog ID",
                    value: <span className="select-all tabular-nums text-ink-3">{title.catalog_id ?? "—"}</span>,
                  },
                ]}
              />
            </Card>

            {/* Release dates */}
            <Card>
              <CardHeader>
                <CardTitle>Release dates</CardTitle>
              </CardHeader>
              <CardBody>
                <ReleaseInfoForm
                  orgId={title.org_id}
                  titleId={title.id}
                  releaseType={title.release_type as ReleaseType}
                  originalReleaseDate={title.original_release_date}
                  releaseDate={title.release_date}
                  canOperate={canOperate}
                />
              </CardBody>
            </Card>
          </div>

          {/* Main column — content-rich sections */}
          <div className="flex flex-col gap-6 lg:order-1 lg:col-span-2">

          {/* Rights & territories */}
          <Card>
            <CardHeader>
              <CardTitle>Rights &amp; territories</CardTitle>
              <CardDescription>Where and how Global Content may distribute this title.</CardDescription>
            </CardHeader>
            {canOperate ? (
              <CardBody className="border-b border-hairline">
                <div className="max-w-xl">
                  <AddRightsForm orgId={title.org_id} titleId={title.id} />
                </div>
              </CardBody>
            ) : null}
            {list.length === 0 ? (
              <CardBody>
                <p className="t-body-sm text-ink-3">No rights granted yet.</p>
              </CardBody>
            ) : (
              <div className="divide-y divide-hairline">
                {list.map((g) => (
                  <div key={g.id} className="flex items-start justify-between gap-4 px-5 py-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="t-body-sm font-medium text-ink">{RIGHTS_META[g.rights_type].label}</span>
                      <span className="t-body-sm text-ink-3">{g.exclusive ? "Exclusive" : "Non-exclusive"}</span>
                    </div>
                    <span className="shrink-0 t-body-sm text-ink-2">
                      {describeTerritory(g.territory_mode, g.territories)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Deliveries */}
          <Card>
            <CardHeader>
              <CardTitle>Deliveries</CardTitle>
            </CardHeader>
            {titleDlv.length === 0 ? (
              <CardBody>
                <p className="t-body-sm text-ink-3">Not yet delivered to any platform.</p>
              </CardBody>
            ) : (
              <div className="divide-y divide-hairline">
                {titleDlv.map((d) => (
                  <div key={d.delivery_id} className="flex items-center justify-between gap-4 px-5 py-3">
                    <span className="t-body-sm text-ink-2">
                      {d.vendor_name} · {d.territory}
                    </span>
                    <span className="shrink-0 t-body-sm font-medium text-ink">
                      {DELIVERY_STATUS_ROW_LABELS[d.status]}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Artwork & assets — files are downloadable, not previewed here (the visuals
              live in the hero + catalog). Each: a view/download button, info beneath. */}
          <Card>
            <CardHeader>
              <CardTitle>Artwork &amp; assets</CardTitle>
              <CardDescription>Every title needs a poster and a banner. Open a file to view or download it.</CardDescription>
            </CardHeader>
            {canOperate ? (
              <CardBody className="border-b border-hairline">
                <div className="max-w-xl space-y-4">
                  <AssetUpload titleId={title.id} />
                  <ScreenerSourceControl
                    titleId={title.id}
                    current={(title.screener_source ?? "master") as "master" | "dedicated"}
                  />
                </div>
              </CardBody>
            ) : null}
            {assetList.length === 0 ? (
              <CardBody>
                <p className="t-body-sm text-ink-3">No files uploaded yet.</p>
              </CardBody>
            ) : (
              <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
                {assetList.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-col gap-2 rounded-[var(--radius)] border border-hairline bg-surface p-3"
                  >
                    <AssetDownloadButton assetId={a.id} kind={a.kind} />
                    <div className="flex min-w-0 flex-col px-0.5">
                      <span className="t-label text-ink-2">{ASSET_KIND_LABELS[a.kind]}</span>
                      <span className="truncate t-body-sm text-ink-3">
                        {a.original_filename ? `${a.original_filename} · ` : ""}
                        {formatBytes(a.bytes)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          </div>
        </div>
      </div>
    </>
  );
}
