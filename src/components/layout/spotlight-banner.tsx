import Link from "next/link";
import { Play } from "lucide-react";

import { cn } from "@/lib/cn";

// The full-bleed catalog hero (Visual register): the featured title's BANNER as an
// edge-to-edge backdrop with a scrim and overlaid kicker / big title / status / CTA —
// Apple-TV register. Theme-consistent: the charcoal band fallback + band-ink text read
// well in both light and dark, so no per-area theme flip is needed. Tall, no border/round.
export function SpotlightBanner({
  href,
  kicker,
  title,
  bannerUrl,
  statusLabel,
  active = false,
  meta,
  className,
}: {
  href: string;
  kicker?: string;
  title: string;
  bannerUrl: string | null;
  statusLabel: string;
  active?: boolean;
  meta?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex min-h-[400px] w-full flex-col justify-end overflow-hidden bg-band text-band-ink sm:min-h-[520px]",
        className,
      )}
    >
      {bannerUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed CloudFront URL */}
          <img
            src={bannerUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            loading="lazy"
            decoding="async"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/10" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent" />
        </>
      ) : null}

      <div className="relative flex max-w-2xl flex-col gap-3 p-6 sm:p-10">
        {kicker ? <span className="t-label text-accent">{kicker}</span> : null}
        <h2 className="t-title leading-[1.05] text-band-ink">{title}</h2>
        <div className="flex items-center gap-2 t-label text-band-ink/70">
          <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-accent" : "bg-band-ink/50")} />
          {statusLabel}
          {meta ? <span className="text-band-ink/50">· {meta}</span> : null}
        </div>
        <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-band-ink px-4 py-2 t-body-sm font-medium text-band transition-transform group-hover:-translate-y-px">
          <Play className="h-4 w-4" strokeWidth={2} />
          Open
        </span>
      </div>
    </Link>
  );
}
