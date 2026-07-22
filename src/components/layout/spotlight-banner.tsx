import Link from "next/link";

import { cn } from "@/lib/cn";
import { Artwork } from "./artwork";

// Featured title, Apple-TV style, on the charcoal band (Visual register). Poster at
// left, confident title + a band-appropriate status line (the light StatusChip would
// read wrong on the dark band, so status is inline band-ink with the accent dot).
export function SpotlightBanner({
  href,
  kicker,
  title,
  posterUrl,
  statusLabel,
  active = false,
  meta,
}: {
  href: string;
  kicker?: string;
  title: string;
  posterUrl: string | null;
  statusLabel: string;
  active?: boolean;
  meta?: string;
}) {
  return (
    <Link
      href={href}
      className="group grid grid-cols-[5rem_1fr] gap-5 overflow-hidden rounded-[var(--radius-lg)] bg-band p-5 text-band-ink transition-all hover:shadow-[var(--elevation)] sm:grid-cols-[8rem_1fr] sm:gap-7 sm:p-7"
    >
      <Artwork src={posterUrl} title={title} className="aspect-[2/3] w-full" />
      <div className="flex flex-col justify-center gap-3">
        {kicker ? <span className="t-label text-accent">{kicker}</span> : null}
        <span className="t-statement leading-tight text-band-ink">{title}</span>
        <div className="flex items-center gap-2 t-label text-band-ink/60">
          <span
            className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-accent" : "bg-band-ink/40")}
          />
          {statusLabel}
          {meta ? <span className="text-band-ink/40">· {meta}</span> : null}
        </div>
      </div>
    </Link>
  );
}
