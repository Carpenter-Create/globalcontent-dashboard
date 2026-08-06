import Link from "next/link";

import { Artwork } from "./artwork";
import { StatusChip } from "./status-chip";

// The poster-grid cell (layout standard, "modern + visual"): poster → title → status +
// meta. The cinematic analogue of a DataTable row. Subtle hover lift; the poster carries
// the visual weight, the text stays quiet.
export function PosterCard({
  href,
  title,
  posterUrl,
  status,
  meta,
}: {
  href: string;
  title: string;
  posterUrl: string | null;
  status?: { label: string; tone?: "neutral" | "active" | "muted" };
  meta?: React.ReactNode;
}) {
  return (
    // prefetch=false: a catalog grid is N links; viewport prefetch means N full renders.
    <Link href={href} prefetch={false} className="group flex flex-col gap-2.5">
      <Artwork
        src={posterUrl}
        title={title}
        className="aspect-[2/3] w-full border border-hairline transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[var(--elevation)]"
      />
      <div className="flex flex-col gap-1.5">
        <span className="line-clamp-1 t-body-sm font-medium text-ink">{title}</span>
        <div className="flex items-center justify-between gap-2">
          {status ? <StatusChip label={status.label} tone={status.tone} /> : <span />}
          {meta ? <span className="shrink-0 t-body-sm text-ink-3">{meta}</span> : null}
        </div>
      </div>
    </Link>
  );
}
