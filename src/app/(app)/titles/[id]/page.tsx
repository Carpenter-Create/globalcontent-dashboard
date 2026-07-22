import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { PageStack, PageSection } from "@/components/layout/page-section";
import { TitleHero } from "@/components/layout/title-hero";
import { FieldList } from "@/components/layout/field-list";
import { StatusChip } from "@/components/layout/status-chip";
import { Artwork } from "@/components/layout/artwork";
import { RIGHTS_META } from "@/lib/rights";
import { describeTerritory } from "@/lib/territories";
import { requiredComplete } from "@/lib/metadata";
import { InlineNotice } from "@/components/ui/inline-notice";
import { FindingsCard } from "@/components/findings/findings-card";
import { titleArtworkUrls } from "@/lib/artwork";
import { RELEASE_TYPE_LABEL, formatReleaseDate, type ReleaseType } from "@/lib/releases";
import { AddRightsForm } from "./add-rights-form";
import { ReleaseInfoForm } from "./release-info-form";
import { AssetUpload } from "./asset-upload";
import { ScreenerSourceControl } from "./screener-source-control";
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

// Title detail — the streaming-title-page × catalog/information-management hybrid: a banner
// hero on top, then the catalog/info sections below. RLS-scoped; only operate-capable roles
// (account_owner, delivery_ops — §4) see the edit forms.
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
      />

      <div className="mt-6">
        <PageStack>
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

          {/* Overview — the ledger */}
          <PageSection eyebrow="Overview">
            <FieldList
              items={[
                { label: "Status", value: <StatusChip label={statusLabel} tone={statusTone} /> },
                { label: "Release type", value: RELEASE_TYPE_LABEL[title.release_type as ReleaseType] },
                {
                  label: "Rights",
                  value: `${list.length} ${list.length === 1 ? "grant" : "grants"}`,
                },
                {
                  label: "Metadata",
                  value: `${complete.filled} of ${complete.total} required complete`,
                },
                // GC-internal cataloging/accounting reference — demoted + copyable, not a headline.
                {
                  label: "Catalog ID",
                  value: <span className="select-all tabular-nums text-ink-3">{title.catalog_id ?? "—"}</span>,
                },
              ]}
            />
          </PageSection>

          {/* Release dates */}
          <PageSection eyebrow="Release">
            <Card>
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
          </PageSection>

          {/* Rights & territories */}
          <PageSection eyebrow="Rights & territories">
            {canOperate ? (
              <div className="mb-3 max-w-xl">
                <AddRightsForm orgId={title.org_id} titleId={title.id} />
              </div>
            ) : null}
            {list.length === 0 ? (
              <Card>
                <CardBody>
                  <p className="t-body-sm text-ink-3">No rights granted yet.</p>
                </CardBody>
              </Card>
            ) : (
              <div className="flex flex-col gap-2">
                {list.map((g) => (
                  <Card key={g.id}>
                    <CardBody className="flex items-start justify-between gap-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="t-body font-medium text-ink">{RIGHTS_META[g.rights_type].label}</span>
                        <span className="t-body-sm text-ink-3">
                          {g.exclusive ? "Exclusive" : "Non-exclusive"}
                        </span>
                      </div>
                      <span className="shrink-0 t-body-sm text-ink-2">
                        {describeTerritory(g.territory_mode, g.territories)}
                      </span>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </PageSection>

          {/* Deliveries */}
          <PageSection eyebrow="Deliveries">
            {titleDlv.length === 0 ? (
              <Card>
                <CardBody>
                  <p className="t-body-sm text-ink-3">Not yet delivered to any platform.</p>
                </CardBody>
              </Card>
            ) : (
              <div className="flex flex-col gap-2">
                {titleDlv.map((d) => (
                  <Card key={d.delivery_id}>
                    <CardBody className="flex items-center justify-between gap-4">
                      <span className="t-body-sm text-ink-2">
                        {d.vendor_name} · {d.territory}
                      </span>
                      <span className="shrink-0 t-body-sm font-medium text-ink">
                        {DELIVERY_STATUS_ROW_LABELS[d.status]}
                      </span>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </PageSection>

          {/* Artwork — poster + banner, both expected on every title */}
          <PageSection eyebrow="Artwork" description="Every title needs a poster and a banner.">
            <div className="flex flex-wrap gap-5">
              <ArtworkSlot label="Poster" hint="Vertical · ~2:3" src={art.poster} className="w-28 aspect-[2/3]" />
              <ArtworkSlot label="Banner" hint="Horizontal · 16:9" src={art.banner} className="w-56 aspect-video" />
            </div>
            {canOperate ? (
              <div className="mt-4 max-w-xl space-y-4">
                <AssetUpload titleId={title.id} />
                <ScreenerSourceControl
                  titleId={title.id}
                  current={(title.screener_source ?? "master") as "master" | "dedicated"}
                />
              </div>
            ) : null}
            {assetList.length > 0 ? (
              <div className="mt-4 flex flex-col gap-2">
                {assetList.map((a) => (
                  <Card key={a.id}>
                    <CardBody className="flex items-center justify-between gap-4">
                      <span className="t-body-sm font-medium text-ink">
                        {a.original_filename ?? ASSET_KIND_LABELS[a.kind]}
                      </span>
                      <span className="shrink-0 t-body-sm text-ink-3">
                        {ASSET_KIND_LABELS[a.kind]} · {formatBytes(a.bytes)}
                      </span>
                    </CardBody>
                  </Card>
                ))}
              </div>
            ) : null}
          </PageSection>

          {/* Metadata */}
          <PageSection
            eyebrow="Metadata"
            actions={
              <Link href={`/titles/${id}/metadata`} className="t-body-sm text-accent">
                {canOperate ? "Edit metadata" : "View metadata"}
              </Link>
            }
          >
            <FieldList
              items={[
                {
                  label: "Required fields",
                  value: `${complete.filled} of ${complete.total} complete`,
                },
              ]}
            />
          </PageSection>
        </PageStack>
      </div>
    </>
  );
}

// A labelled artwork slot showing the current graphic or a "not uploaded" placeholder.
function ArtworkSlot({
  label,
  hint,
  src,
  className,
}: {
  label: string;
  hint: string;
  src: string | null;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Artwork src={src} title={label} className={`${className} border border-hairline`} />
      <div className="flex flex-col">
        <span className="t-label text-ink-2">{label}</span>
        <span className="t-body-sm text-ink-3">{src ? hint : `${hint} · not uploaded`}</span>
      </div>
    </div>
  );
}
