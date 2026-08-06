import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/cn";
import { Artwork } from "./artwork";

// The streaming title-page hero (Visual register): the title's BANNER as a full-bleed
// backdrop + gradient, with the poster, status, title, and key facts overlaid — the top
// of the title-page hybrid. Falls back to the charcoal band when there's no banner so
// overlaid text always reads. The catalog/info surfaces live below this.
export function TitleHero({
  title,
  backHref,
  backLabel = "Back",
  statusLabel,
  active = false,
  posterUrl,
  bannerUrl,
  facts = [],
  action,
}: {
  title: string;
  backHref: string;
  backLabel?: string;
  statusLabel: string;
  active?: boolean;
  posterUrl: string | null;
  bannerUrl: string | null;
  facts?: { label: string; value: React.ReactNode }[];
  action?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-[var(--radius-lg)] border border-hairline bg-band text-band-ink">
      {bannerUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed CloudFront URL */}
          <img src={bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/25" />
        </>
      ) : null}

      <div className="relative flex flex-col gap-5 p-5 sm:p-7">
        <Link
          href={backHref}
          className="inline-flex w-fit items-center gap-1 t-body-sm text-band-ink/70 transition-colors hover:text-band-ink"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          {backLabel}
        </Link>

        <div className="flex items-end gap-5">
          <div className="w-24 shrink-0 sm:w-28">
            <Artwork
              src={posterUrl}
              title={title}
              className="aspect-[2/3] w-full border border-band-ink/10 shadow-lg"
              sizes="(max-width: 640px) 96px, 112px"
              priority
            />
          </div>
          <div className="flex flex-col gap-2 pb-1">
            <span className="inline-flex items-center gap-1.5 t-label text-band-ink/60">
              <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-accent" : "bg-band-ink/50")} />
              {statusLabel}
            </span>
            <h1 className="t-statement leading-tight text-band-ink">{title}</h1>
            {facts.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-1">
                {facts.map((f, i) => (
                  <span key={i} className="t-body-sm text-band-ink/70">
                    <span className="text-band-ink/50">{f.label}: </span>
                    <span className="t-data text-band-ink">{f.value}</span>
                  </span>
                ))}
              </div>
            ) : null}
            {action ? <div className="pt-3">{action}</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
