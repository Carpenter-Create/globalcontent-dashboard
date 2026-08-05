import { Skeleton, TableSkeleton, PosterGridSkeleton } from "@/components/layout/skeleton";

// Route-level loading shells.
//
// WHY THESE EXIST AT ALL. Without a loading.tsx, the App Router waits for the ENTIRE
// server response before painting anything: the previous page sits frozen with no
// feedback, then the new one snaps in. At 300ms of real network that reads as sluggish
// even though the numbers are fine. A loading.tsx is a Suspense boundary the router can
// show the instant a Link is clicked.
//
// AND IT UNLOCKS PREFETCH. Next.js prefetches a dynamic route by fetching its LOADING
// state. With no loading.tsx there is nothing to prefetch, so every navigation starts
// cold at click time instead of being warmed on hover. This is the larger of the two
// wins and it is invisible until the file exists.
//
// Shape matters: a skeleton whose proportions differ from the real content causes a
// visible reflow on swap, which feels worse than no skeleton. Each of these mirrors the
// header + body of the surface it stands in for.

/** Header block matching PageHeader's title + subtitle proportions. */
export function HeaderSkeleton({ withActions = false }: { withActions?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 pb-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-3.5 w-72" />
      </div>
      {withActions ? <Skeleton className="h-9 w-32 rounded-[var(--radius-sm)]" /> : null}
    </div>
  );
}

/** Catalog: header + search/sort controls + the poster grid. */
export function CatalogSkeleton() {
  return (
    <>
      <div className="flex items-start justify-between gap-4 pb-6">
        <Skeleton className="h-8 w-32" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-56 rounded-[var(--radius-sm)]" />
          <Skeleton className="h-9 w-24 rounded-[var(--radius-sm)]" />
        </div>
      </div>
      <PosterGridSkeleton count={8} />
    </>
  );
}

/** Any list-of-rows surface: deliveries, vendors, the GC queue. */
export function ListSkeleton({ rows = 6, withActions = false }: { rows?: number; withActions?: boolean }) {
  return (
    <>
      <HeaderSkeleton withActions={withActions} />
      <TableSkeleton rows={rows} />
    </>
  );
}

/** Stacked cards: messages, findings, catalog health. */
export function CardListSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <>
      <HeaderSkeleton />
      <div className="flex flex-col gap-3">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="rounded-[var(--radius-lg)] border border-hairline p-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Title detail: the charcoal hero, then the two-column body. */
export function TitleDetailSkeleton() {
  return (
    <>
      <Skeleton className="h-[220px] w-full rounded-[var(--radius-lg)]" />
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-48 w-full rounded-[var(--radius-lg)]" />
          <Skeleton className="h-32 w-full rounded-[var(--radius-lg)]" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-40 w-full rounded-[var(--radius-lg)]" />
          <Skeleton className="h-28 w-full rounded-[var(--radius-lg)]" />
        </div>
      </div>
    </>
  );
}

/** Dashboard: charted hero, then the stacked snapshot cards. */
export function DashboardSkeleton() {
  return (
    <>
      <Skeleton className="h-[260px] w-full rounded-[var(--radius-lg)]" />
      <div className="mt-3 flex flex-col gap-3">
        <Skeleton className="h-28 w-full rounded-[var(--radius-lg)]" />
        <Skeleton className="h-24 w-full rounded-[var(--radius-lg)]" />
        <Skeleton className="h-24 w-full rounded-[var(--radius-lg)]" />
      </div>
    </>
  );
}
