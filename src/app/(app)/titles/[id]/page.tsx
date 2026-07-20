import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { RIGHTS_META } from "@/lib/rights";
import { describeTerritory } from "@/lib/territories";
import { requiredComplete } from "@/lib/metadata";
import { InlineNotice } from "@/components/ui/inline-notice";
import { AddRightsForm } from "./add-rights-form";
import { AssetUpload } from "./asset-upload";
import { ScreenerSourceControl } from "./screener-source-control";
import { SubmitButton } from "./submit-button";
import { titleDisplayStatus, type TitleStatus } from "@/lib/titles";

const ASSET_KIND_LABELS: Record<"master" | "caption" | "artwork" | "screener", string> = {
  master: "Master",
  caption: "Caption",
  artwork: "Artwork",
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

// Title detail — hosts the rights grants (§9). RLS-scoped; only operate-capable
// roles (account_owner, delivery_ops — §4) see the add form.
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
    .select("id, title, status, org_id, catalog_id, screener_source")
    .eq("id", id)
    .maybeSingle();
  if (!title) notFound(); // RLS returns null for another org's title → 404

  // Capability is the user's role in THE TITLE'S org — not the active org, which
  // may differ when the user belongs to more than one org (§4).
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

  const { data: titleDlv } = await supabase
    .from("deliveries")
    .select("status")
    .eq("title_id", id);
  const liveCount = (titleDlv ?? []).filter((d) => d.status === "live").length;
  const totalCount = (titleDlv ?? []).length;

  return (
    <>
      <PageHeader
        title={title.title}
        subtitle="Rights & territories"
        backLink={{ href: "/titles", label: "Titles" }}
      />

      <div className="mb-6 flex flex-col gap-3">
        <p className="t-body-sm text-ink-3">{title.catalog_id}</p>
        <p className="t-body-sm text-ink-2">
          Status: <span className="font-medium text-ink">
            {titleDisplayStatus(title.status as TitleStatus, liveCount, totalCount)}
          </span>
        </p>
        {showRejection ? (
          <InlineNotice tone="error">Returned for revision: {latestReview!.reason}</InlineNotice>
        ) : null}
        {canOperate && title.status === "draft" ? (
          <SubmitButton orgId={title.org_id} titleId={title.id} />
        ) : null}
      </div>

      {canOperate ? (
        <div className="mb-6 max-w-xl">
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
        <div className="flex flex-col gap-3">
          {list.map((g) => (
            <Card key={g.id}>
              <CardBody className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="t-body font-medium text-ink">{RIGHTS_META[g.rights_type].label}</span>
                  <span className="t-body-sm text-ink-3">{g.exclusive ? "Exclusive" : "Non-exclusive"}</span>
                </div>
                <span className="shrink-0 t-body-sm text-ink-2">
                  {describeTerritory(g.territory_mode, g.territories)}
                </span>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-10">
        <h2 className="t-body font-medium text-ink pb-3">Assets</h2>
        {canOperate ? (
          <div className="mb-4 max-w-xl space-y-4">
            <AssetUpload titleId={title.id} />
            <ScreenerSourceControl
              titleId={title.id}
              current={(title.screener_source ?? "master") as "master" | "dedicated"}
            />
          </div>
        ) : null}
        {assetList.length === 0 ? (
          <Card>
            <CardBody>
              <p className="t-body-sm text-ink-3">No assets uploaded yet.</p>
            </CardBody>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {assetList.map((a) => (
              <Card key={a.id}>
                <CardBody className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="t-body font-medium text-ink">
                      {a.original_filename ?? ASSET_KIND_LABELS[a.kind]}
                    </span>
                    <span className="t-body-sm text-ink-3">
                      {ASSET_KIND_LABELS[a.kind]} · {formatBytes(a.bytes)}
                    </span>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="mt-10">
        <div className="flex items-center justify-between gap-4 pb-3">
          <h2 className="t-body font-medium text-ink">Metadata</h2>
          <Link href={`/titles/${id}/metadata`} className="t-body-sm text-accent">
            {canOperate ? "Edit metadata" : "View metadata"}
          </Link>
        </div>
        <p className="t-body-sm text-ink-3">
          {complete.filled} of {complete.total} required fields complete
        </p>
      </div>
    </>
  );
}
