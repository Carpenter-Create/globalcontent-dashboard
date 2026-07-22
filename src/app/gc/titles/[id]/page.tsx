import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { Card, CardBody } from "@/components/ui/card";
import { InlineNotice } from "@/components/ui/inline-notice";
import { RIGHTS_META } from "@/lib/rights";
import { describeTerritory } from "@/lib/territories";
import { METADATA_FIELDS } from "@/lib/metadata";
import { FindingsCard } from "@/components/findings/findings-card";
import type { ReleaseType } from "@/lib/releases";
import { ReleaseDateControl } from "./release-date-control";
import { gcTitleStatusLabel, DELIVERY_STATUS_ROW_LABELS, type TitleStatus } from "@/lib/titles";
import { ReviewControls } from "@/app/gc/review/review-controls";
import { LinkControls, type Suggestion } from "@/app/gc/review/link-controls";
import { ScreenerPanel, type ScreenerLink, type ScreenerViewer } from "@/app/gc/review/screener-panel";
import { GcAssets, type GcAsset } from "./gc-assets";

// The GC per-title detail = the internal review page (folds in /gc/review). Review actions
// (approve/reject, same-work linking) show only while in_review; screener panel + metadata +
// rights + findings always. Cross-org read via RLS's is_gc_staff bypass. Internal asset viewer
// + delivery-from-here land in later phases of the GC-operator pass.
function fmtMeta(v: unknown): string {
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  return String(v);
}

export default async function GcTitleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: t } = await supabase
    .from("titles")
    .select("id, title, catalog_id, status, work_id, created_at, release_type, original_release_date, release_date, organizations(name)")
    .eq("id", id)
    .maybeSingle();
  if (!t) notFound();

  const [{ data: grants }, { data: suggestions }, { data: conflicts }, { data: screenerLinks }, { data: metaRow }, { data: findings }, { data: assets }, { data: deliveries }] =
    await Promise.all([
      supabase
        .from("rights_grants")
        .select("id, rights_type, territory_mode, territories, exclusive")
        .eq("title_id", id)
        .is("effective_to", null)
        .order("rights_type", { ascending: true }),
      supabase.rpc("suggest_same_work", { p_title_id: id }),
      supabase.rpc("same_work_conflicts", { p_title_id: id }),
      supabase
        .from("portal_links")
        .select("id, title_id, expires_at, revoked_at, created_at, share_token")
        .eq("purpose", "screener_view")
        .eq("title_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("title_metadata").select("data").eq("title_id", id).maybeSingle(),
      supabase
        .from("findings")
        .select("id, message, severity")
        .eq("entity_type", "title")
        .eq("entity_id", id)
        .eq("status", "open"),
      supabase
        .from("assets")
        .select("id, kind, original_filename, bytes")
        .eq("title_id", id)
        .order("kind"),
      supabase
        .from("deliveries")
        .select("id, territory, status, vendors(name)")
        .eq("title_id", id)
        .order("created_at", { ascending: false }),
    ]);

  const links = (screenerLinks ?? []) as ScreenerLink[];
  // The reusable share URL is built server-side (PORTAL_BASE_URL) from the live link's
  // persisted token. Newest live link with a token wins (list is created_at desc).
  const shareLink = links.find((l) => !l.revoked_at && new Date(l.expires_at) > new Date() && l.share_token);
  const portalBase = process.env.PORTAL_BASE_URL?.replace(/\/+$/, "") ?? "";
  const activeShareUrl = shareLink?.share_token ? `${portalBase}/portal/${shareLink.share_token}` : null;
  const engagementEntries = await Promise.all(
    links
      .filter((l) => !l.revoked_at)
      .map(async (l) => {
        const { data } = await supabase.rpc("screener_engagement", { p_link_id: l.id });
        return [l.id, (data ?? []) as ScreenerViewer[]] as const;
      }),
  );
  const engagement = Object.fromEntries(engagementEntries) as Record<string, ScreenerViewer[]>;

  const meta = (metaRow?.data as Record<string, unknown>) ?? {};
  const inReview = t.status === "in_review";

  return (
    <>
      <div className="flex flex-col gap-0.5 pb-6">
        <h1 className="t-subhead text-ink">{t.title}</h1>
        <span className="t-body-sm text-ink-3">
          {t.catalog_id} · {t.organizations?.name ?? "—"} · {gcTitleStatusLabel(t.status as TitleStatus)}
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {/* Findings first — what needs attention on this title. */}
        <FindingsCard findings={findings ?? []} />

        {/* Release date — GC-owned go-to-market date (client cannot set it). */}
        <Card>
          <CardBody>
            <ReleaseDateControl
              titleId={t.id}
              releaseType={t.release_type as ReleaseType}
              originalReleaseDate={t.original_release_date}
              releaseDate={t.release_date}
            />
          </CardBody>
        </Card>

        {/* Rights & territories */}
        <Card>
          <CardBody className="flex flex-col gap-2">
            <span className="t-label text-ink-3">Rights &amp; territories</span>
            {(grants ?? []).length > 0 ? (
              (grants ?? []).map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-4">
                  <span className="t-body-sm text-ink-2">
                    {RIGHTS_META[g.rights_type].label} · {g.exclusive ? "Exclusive" : "Non-exclusive"}
                  </span>
                  <span className="shrink-0 t-body-sm text-ink-3">
                    {describeTerritory(g.territory_mode, g.territories)}
                  </span>
                </div>
              ))
            ) : (
              <span className="t-body-sm text-ink-3">No rights declared.</span>
            )}
            {(conflicts ?? []).length > 0 ? (
              <InlineNotice tone="error">
                Exclusive rights conflict on the same work:{" "}
                {(conflicts ?? [])
                  .map((c) => `${RIGHTS_META[c.rights_type].label} — ${c.other_title} (${c.other_org_name})`)
                  .join("; ")}
              </InlineNotice>
            ) : null}
          </CardBody>
        </Card>

        {/* Deliveries — where this title is placed, per vendor/territory (read-only here;
            GC sets status from the Deliveries queue). */}
        <Card>
          <CardBody className="flex flex-col gap-2">
            <span className="t-label text-ink-3">Deliveries</span>
            {(deliveries ?? []).length > 0 ? (
              (deliveries ?? []).map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-4">
                  <span className="t-body-sm text-ink-2">
                    {d.vendors?.name ?? "—"} · {d.territory}
                  </span>
                  <span className="shrink-0 t-body-sm text-ink-3">
                    {DELIVERY_STATUS_ROW_LABELS[d.status]}
                  </span>
                </div>
              ))
            ) : (
              <span className="t-body-sm text-ink-3">Not yet delivered.</span>
            )}
          </CardBody>
        </Card>

        {/* Metadata (read-only) */}
        <Card>
          <CardBody className="flex flex-col gap-1.5">
            <span className="t-label text-ink-3">Metadata</span>
            {METADATA_FIELDS.map((field) => (
              <div key={field.key} className="flex items-baseline justify-between gap-4 t-body-sm">
                <span className="text-ink-3">{field.label}</span>
                <span className="text-ink-2 text-right">{fmtMeta(meta[field.key])}</span>
              </div>
            ))}
          </CardBody>
        </Card>

        {/* Review actions — only while awaiting review */}
        {inReview ? (
          <Card>
            <CardBody className="flex flex-col gap-3">
              <span className="t-label text-ink-3">Review</span>
              {t.work_id ? null : (
                <LinkControls titleId={t.id} suggestions={(suggestions ?? []) as Suggestion[]} />
              )}
              <ReviewControls titleId={t.id} />
            </CardBody>
          </Card>
        ) : null}

        {/* Screener (external pitch link) + engagement */}
        <Card>
          <CardBody>
            <ScreenerPanel titleId={t.id} links={links} engagement={engagement} activeShareUrl={activeShareUrl} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
