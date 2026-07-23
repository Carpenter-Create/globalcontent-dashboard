import Link from "next/link";

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
  return (
    <Link href={href} className="group flex flex-col gap-2.5">
      <Artwork
        src={bannerUrl}
        title={title}
        className="aspect-video w-full border border-hairline transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[var(--elevation)]"
      />
      <div className="flex flex-col gap-1.5">
        <span className="line-clamp-1 t-body-sm font-medium text-ink">{title}</span>
        {/* Sub-row: status pill (when set) + meta. With only meta it left-aligns; with
            neither, the row is dropped entirely so the card ends on the title. */}
        {status || meta ? (
          <div className="flex items-center justify-between gap-2">
            {status ? <StatusChip label={status.label} tone={status.tone} /> : null}
            {meta ? <span className="shrink-0 t-body-sm text-ink-3">{meta}</span> : null}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
