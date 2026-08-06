"use client";

import { useState } from "react";

import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Artwork } from "@/components/layout/artwork";
import { METADATA_FIELDS, GENRES, type FieldDef } from "@/lib/metadata";
import { PORTAL_COPY, downloadFailureMessage } from "@/lib/portal";
import { ScreenerRoom } from "./screener-room";
import type { ReadyView } from "./portal-flow";

type ScreenerReady = Extract<ReadyView, { mode: "screener" }>;

// A `select` field stores its vocabulary's slug (e.g. genre's "sci_fi"), not its label — the
// grid must resolve it the same way the key-facts line does, or the same value reads two
// different ways on one screen (fix round 1, task 8). Every `select` field with a `vocab`
// gets this, not just genre: rating, primary_language, country_of_origin all have the
// identical slug-vs-label shape.
function displayValue(field: FieldDef, value: unknown): unknown {
  if (field.type !== "select" || !field.vocab || typeof value !== "string") return value;
  return field.vocab.find((v) => v.value === value)?.label ?? value;
}

// Iterates the canonical field registry, never a page-local list, so a new metadata field
// shows up here the moment it's added to lib/metadata.ts.
function MetadataGrid({ data }: { data: Record<string, unknown> }) {
  const rows = METADATA_FIELDS.map((f) => ({ label: f.label, value: displayValue(f, data[f.key]) }))
    // Omitted, not blanked — a half-filled sheet reads as neglect.
    .filter((r) => r.value !== null && r.value !== undefined && r.value !== ""
                   && !(Array.isArray(r.value) && r.value.length === 0));

  return (
    <dl className="divide-y divide-hairline">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-6 py-2">
          <dt className="t-label text-ink-2">{r.label}</dt>
          <dd className="t-body-sm text-ink text-right tabular-nums">
            {Array.isArray(r.value) ? r.value.join(", ") : String(r.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// The hero's artwork chain is a strict priority, not a composite: banner, else poster, else
// the title alone. A poster stretched to a 16:9 crop would misrepresent the art, so when
// there's no banner the poster keeps its own portrait aspect on a token-coloured field
// instead. Every branch is a fixed aspect-video box — there is no state that renders a
// broken image or a collapsed hero.
function ArtworkHero({
  title,
  facts,
  posterUrl,
  bannerUrl,
}: {
  title: string;
  facts: string[];
  posterUrl: string | null;
  bannerUrl: string | null;
}) {
  if (bannerUrl) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-lg)] border border-hairline bg-band">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed CloudFront URL, full-bleed backdrop (see title-hero.tsx) */}
        <img src={bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-5 sm:p-7">
          <h1 className="t-statement leading-tight text-band-ink">{title}</h1>
          {facts.length > 0 && <p className="t-body-sm text-band-ink/70">{facts.join(" · ")}</p>}
        </div>
      </div>
    );
  }

  if (posterUrl) {
    return (
      <div className="flex aspect-video w-full items-center gap-5 overflow-hidden rounded-[var(--radius-lg)] border border-hairline bg-surface-muted p-5 sm:p-7">
        <div className="w-24 shrink-0 sm:w-32">
          <Artwork
            src={posterUrl}
            title={title}
            className="aspect-[2/3] w-full border border-hairline"
            sizes="(max-width: 640px) 96px, 128px"
            priority
          />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="t-statement leading-tight text-ink">{title}</h1>
          {facts.length > 0 && <p className="t-body-sm text-ink-2">{facts.join(" · ")}</p>}
        </div>
      </div>
    );
  }

  // Neither graphic exists — the title carries the hero alone. A monogram placeholder here
  // (the catalog-grid convention) would read as a missing/broken asset to an external buyer;
  // plain type does not.
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-lg)] border border-hairline bg-surface-muted px-6 text-center">
      <h1 className="t-statement text-ink-3">{title}</h1>
      {facts.length > 0 && <p className="t-body-sm text-ink-3">{facts.join(" · ")}</p>}
    </div>
  );
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  return /filename="?([^";]+)"?/.exec(header)?.[1] ?? null;
}

// Fix round 2, item 2: reads the route's own 403 body (if any) before deciding what to tell
// the buyer, rather than collapsing every non-409 failure into "this link has expired." Only
// a 403 body is parsed — 409/5xx/other never carry a message worth reading, and parsing a
// body that isn't there would be its own bug.
async function describeDownloadFailure(r: Response): Promise<string> {
  let bodyError: string | undefined;
  if (r.status === 403) {
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    bodyError = body?.error;
  }
  return downloadFailureMessage(r.status, bodyError);
}

// The buyer title page: a share-link recipient's landing view once they've passed the
// identity→OTP gate. "A clear mixture of utility meets film aesthetic" (founder) — viewing
// (hero, trailer, screener) and information (spec sheet) carry equal visual weight, side by
// side at `lg:` and above; below that they stack, viewing first.
//
// `company` is the buyer's OWN typed input from the identity gate (portal-flow.tsx), not
// `ready.recipientName` — that field is the link's internal client-side tracking label and
// must never render on this external page (see the "Prepared for" usage below).
export function TitlePage({ ready, company }: { ready: ScreenerReady; company: string }) {
  const [watching, setWatching] = useState(false);
  const [pending, setPending] = useState<null | "screener" | "metadata" | "master">(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const meta = ready.metadata;
  const genreValue =
    typeof meta.genre === "string"
      ? (GENRES.find((g) => g.value === meta.genre)?.label ?? meta.genre)
      : null;
  const facts = [
    meta.release_year != null ? String(meta.release_year) : null,
    ready.runtimeMinutes != null ? `${ready.runtimeMinutes} min` : null,
    genreValue,
    typeof meta.rating === "string" ? meta.rating : null,
  ].filter((f): f is string => Boolean(f));

  // Screener and master both resolve to a signed URL the browser navigates straight to
  // (same shape as the existing /api/portal/download and /api/portal/screener routes).
  // Metadata returns the generated file itself (Task 9), so it gets its own handler below.
  async function downloadViaUrl(path: string, key: "screener" | "master") {
    setPending(key);
    setActionError(null);
    const r = await fetch(path, { method: "POST" });
    setPending(null);
    if (!r.ok) return setActionError(await describeDownloadFailure(r));
    const { url } = await r.json();
    window.location.href = url;
  }

  async function downloadMetadata() {
    setPending("metadata");
    setActionError(null);
    const r = await fetch("/api/portal/metadata-export", { method: "POST" });
    setPending(null);
    if (!r.ok) return setActionError(await describeDownloadFailure(r));
    const blob = await r.blob();
    const filename = filenameFromContentDisposition(r.headers.get("content-disposition")) ?? `${ready.title}.xlsx`;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
      {/* Viewing — first in document order so it leads on the single-column (mobile) layout,
          per the brief's equal-weight principle. */}
      <div className="flex flex-col gap-4">
        {company && <p className="t-label text-ink-3">Prepared for {company}</p>}

        <ArtworkHero
          title={ready.title}
          facts={facts}
          posterUrl={ready.posterUrl}
          bannerUrl={ready.bannerUrl}
        />

        {ready.synopsis && <p className="t-body text-ink-2">{ready.synopsis}</p>}

        {ready.trailerUrl && (
          <div className="flex flex-col gap-2">
            <span className="t-label text-ink-3">Trailer</span>
            {/* Promotional material (assets.ts) — same sensitivity class as poster/banner,
                so a plain controls playback with no view-only restrictions is correct here;
                that hint belongs to the screener below, not the trailer. */}
            <video
              src={ready.trailerUrl}
              controls
              className="w-full rounded-[var(--radius-sm)] bg-ink"
            />
          </div>
        )}

        {actionError && <InlineNotice tone="error">{actionError}</InlineNotice>}

        <div className="flex flex-wrap gap-3">
          {ready.actions.canWatchScreener && !watching && (
            <Button variant="secondary" onClick={() => setWatching(true)}>
              {PORTAL_COPY.watchButton}
            </Button>
          )}
          {ready.actions.canDownloadScreener && (
            <Button
              variant="secondary"
              disabled={pending === "screener"}
              onClick={() => downloadViaUrl("/api/portal/screener-download", "screener")}
            >
              {PORTAL_COPY.downloadScreenerButton}
            </Button>
          )}
          {ready.actions.canDownloadMetadata && (
            <Button variant="secondary" disabled={pending === "metadata"} onClick={downloadMetadata}>
              {PORTAL_COPY.downloadMetadataButton}
            </Button>
          )}
        </div>

        {/* "Show the work" (fix round 2, item 3): a title that can be watched but has nothing
            to download is a real, intentional state — the button just silently not being
            there reads as a bug to an external buyer, not a deliberate choice. */}
        {ready.actions.canWatchScreener && !ready.actions.canDownloadScreener && (
          <p className="t-body-sm text-ink-3">{PORTAL_COPY.screenerDownloadUnavailableNotice}</p>
        )}

        {watching && ready.actions.canWatchScreener && (
          // Synopsis is already shown above, next to the hero — passing null here avoids
          // repeating it inside the player card.
          <ScreenerRoom title={ready.title} synopsis={null} runtimeMinutes={ready.runtimeMinutes} />
        )}

        {/* Master download is deliberately its own bordered block, not another button in the
            row above: a buyer who ingests the evaluation screener instead of the licensed
            master (or vice versa) has a real problem, and the two must never be visually
            interchangeable. */}
        {ready.actions.canDownloadMaster && (
          <Card className="border-ink/20">
            <CardBody className="flex flex-col gap-3">
              <span className="t-label text-ink-2">{PORTAL_COPY.downloadMasterHeading}</span>
              <p className="t-body-sm text-ink-3">{PORTAL_COPY.downloadMasterNotice}</p>
              <Button
                disabled={pending === "master"}
                onClick={() => downloadViaUrl("/api/portal/master-download", "master")}
              >
                {PORTAL_COPY.downloadMasterButton}
              </Button>
            </CardBody>
          </Card>
        )}
      </div>

      {/* Information — the spec sheet. Equal weight to viewing, not a footnote under it. */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle>{PORTAL_COPY.specificationsHeading}</CardTitle>
            {ready.catalogId && <CardDescription>Catalog ID · {ready.catalogId}</CardDescription>}
          </CardHeader>
          <CardBody>
            <MetadataGrid data={ready.metadata} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
