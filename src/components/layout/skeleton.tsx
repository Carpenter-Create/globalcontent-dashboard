import { cn } from "@/lib/cn";

// Loading skeletons (layout standard). Shown via RSC + Suspense while a surface's
// data streams in. Subtle pulse; the global reduced-motion rule disables it.
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[var(--radius-sm)] bg-surface-muted", className)} />;
}

// A poster-grid skeleton (matches the catalog grid cell footprint).
export function PosterGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="aspect-[2/3] w-full rounded-[var(--radius)]" />
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

// A table skeleton (matches DataTable rows).
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-hairline">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-hairline px-4 py-3 last:border-0">
          <Skeleton className="h-9 w-6 rounded-[4px]" />
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="ml-auto h-3.5 w-16" />
          <Skeleton className="h-3.5 w-12" />
        </div>
      ))}
    </div>
  );
}
