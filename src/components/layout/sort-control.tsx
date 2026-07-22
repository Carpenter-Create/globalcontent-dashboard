import Link from "next/link";

import { cn } from "@/lib/cn";

// URL-driven sort pills (server component, no client JS). One option is active at a time,
// styled as a solid ink pill (greyscale — accent stays reserved). Shares the chip language
// with StatusFilter; preserves other params via the hrefFor builder.
export function SortControl({
  current,
  options,
  hrefFor,
}: {
  current: string;
  options: { id: string; label: string }[];
  hrefFor: (id: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sort titles">
      <span className="pr-0.5 t-label text-ink-3">Sort</span>
      {options.map((o) => {
        const active = o.id === current;
        return (
          <Link
            key={o.id}
            href={hrefFor(o.id)}
            aria-current={active ? "true" : undefined}
            className={cn(
              "rounded-full px-3 py-1 t-label transition-colors",
              active ? "bg-ink text-canvas" : "bg-surface-muted text-ink-2 hover:text-ink",
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
