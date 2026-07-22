import Link from "next/link";

import { cn } from "@/lib/cn";

// Featured title, streaming-hero style: the landscape BANNER as a full-bleed backdrop with
// a gradient scrim and overlaid title/status (Apple-TV register). Falls back to the charcoal
// band when a title has no banner yet, so overlaid text always reads.
export function SpotlightBanner({
  href,
  kicker,
  title,
  bannerUrl,
  statusLabel,
  active = false,
  meta,
}: {
  href: string;
  kicker?: string;
  title: string;
  bannerUrl: string | null;
  statusLabel: string;
  active?: boolean;
  meta?: string;
}) {
  return (
    <Link
      href={href}
      className="group relative block aspect-video w-full overflow-hidden rounded-[var(--radius-lg)] border border-hairline bg-band sm:aspect-[21/9]"
    >
      {bannerUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed CloudFront URL */}
          <img
            src={bannerUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
            decoding="async"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        </>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-5 text-band-ink sm:p-8">
        {kicker ? <span className="t-label text-accent">{kicker}</span> : null}
        <span className="t-statement leading-tight text-band-ink">{title}</span>
        <div className="flex items-center gap-2 t-label text-band-ink/70">
          <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-accent" : "bg-band-ink/50")} />
          {statusLabel}
          {meta ? <span className="text-band-ink/50">· {meta}</span> : null}
        </div>
      </div>
    </Link>
  );
}
