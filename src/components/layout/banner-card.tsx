"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Artwork } from "./artwork";
import { StatusChip } from "./status-chip";

// The landscape (16:9) browse cell — the horizontal analogue of PosterCard, using a
// title's banner graphic. Used by the streaming rails + grid (Visual register).
export function BannerCard({
  href,
  title,
  bannerUrl,
  status,
  meta,
}: {
  href: string;
  title: string;
  bannerUrl: string | null;
  status?: { label: string; tone: "neutral" | "active" | "muted" };
  meta?: React.ReactNode;
}) {
  const router = useRouter();
  return (
    // prefetch=false: a catalog grid is N links; viewport prefetch means N full renders.
    <Link
      href={href}
      // Viewport prefetch off (a grid is N links = N renders); hover warms just
      // the one the pointer is on.
      prefetch={false}
      onMouseEnter={() => router.prefetch(href)}
      className="group flex flex-col gap-3"
    >
      <Artwork
        src={bannerUrl}
        title={title}
        rounded="rounded-[var(--radius-lg)]"
        className="aspect-video w-full border border-hairline transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-ink-3/25 group-hover:shadow-[var(--elevation)]"
      />
      <div className="flex flex-col gap-1">
        <span className="line-clamp-1 t-body font-medium leading-snug text-ink transition-colors group-hover:text-accent">
          {title}
        </span>
        {/* Sub-row: status pill (when set) + meta. With only meta it left-aligns; with
            neither, the row is dropped entirely so the card ends on the title. */}
        {status || meta ? (
          <div className="flex items-center justify-between gap-2">
            {status ? <StatusChip label={status.label} tone={status.tone} /> : null}
            {meta ? (
              <span className="shrink-0 t-body-sm tabular-nums text-ink-3">{meta}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
