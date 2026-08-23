import Link from "next/link";

import { Artwork } from "@/components/layout/artwork";
import { cn } from "@/lib/cn";
import { TITLES_CATALOG } from "@/lib/titles-catalog";

// Client `/titles` chrome only. Not the shared Card, BannerCard, or DataTable —
// those must not restyle home, Deliveries, Catalog Health, or staff surfaces.
// Desktop 1:3 stays the unboxed grid: full-bleed 2:3 art, type in air, year and
// TITLE_STATUS_LABELS hairline pill. Mobile 528:542 / empty 529:542 is one
// Recent snap rail (140×210 r12, title + year, 16 between cards) and header
// search — no Apple TV dark, ranks, Store, or second rail. First and last
// posters sit 16 from the viewport via the frame inset — do not pair -mx-4
// with px-4 on the track; that cancels the frame's px-4. Accent is Add Title
// only (13 Sporty Blue text). Page-local still crop: every catalog
// img is object-cover / object-center so Artwork's default treatment cannot
// diverge.

export function TitlesCatalogFrame({
  className,
  empty = false,
  ...props
}: React.ComponentProps<"div"> & { empty?: boolean }) {
  return (
    <div
      className={cn(
        "titles-catalog mx-auto flex w-full flex-col px-[var(--space-4)] py-[var(--space-12)] md:px-[var(--space-10)] md:py-0 md:pt-[var(--space-8)]",
        empty ? "gap-[var(--space-6)] md:gap-[var(--space-8)]" : "gap-[var(--space-12)] md:gap-[var(--space-8)]",
        className,
      )}
      style={{ maxWidth: "var(--content-max)" }}
      data-titles-catalog=""
      {...props}
    />
  );
}

export function TitlesCatalogHeader({
  action,
  count,
  identity,
}: {
  action?: React.ReactNode;
  count?: string;
  identity?: string;
}) {
  return (
    <header className="titles-catalog-header flex items-center justify-between gap-[var(--space-2)] md:items-start md:gap-[var(--space-6)]">
      <div className="min-w-0 flex-1">
        {identity ? (
          <h1
            className="truncate t-section text-ink md:hidden"
            data-titles-catalog-identity=""
          >
            {identity}
          </h1>
        ) : null}
        <h1 className="t-section text-ink max-md:hidden">{TITLES_CATALOG.title}</h1>
        {count ? (
          <p
            className="mt-[var(--space-1)] t-body-sm text-ink-3 max-md:hidden"
            data-titles-catalog-count=""
          >
            {count}
          </p>
        ) : null}
      </div>
      {action ? (
        <div
          className="titles-catalog-operate flex shrink-0 items-center gap-[var(--space-4)]"
          data-titles-catalog-operate=""
        >
          {action}
        </div>
      ) : null}
    </header>
  );
}

export function TitlesCatalogEmpty({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("titles-catalog-empty py-[var(--space-16)] max-md:py-0", className)}>
      <p className="t-body text-ink-2">{children}</p>
    </div>
  );
}

export function TitlesCatalogGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="titles-catalog-grid hidden gap-x-[var(--space-8)] gap-y-[var(--space-16)] md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      data-titles-catalog-grid=""
    >
      {children}
    </div>
  );
}

export function TitlesCatalogRail({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="titles-catalog-rail flex flex-col gap-[var(--space-6)] md:hidden"
      data-titles-catalog-rail=""
      aria-label={TITLES_CATALOG.recent}
    >
      <p className="t-body-sm text-ink-2">{TITLES_CATALOG.recent}</p>
      <div
        className="flex snap-x snap-mandatory gap-[var(--space-4)] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-titles-catalog-rail-track=""
      >
        {children}
      </div>
    </section>
  );
}

export function TitlesCatalogRailStill({
  href,
  title,
  stillUrl,
  status,
  year,
}: {
  href: string;
  title: string;
  stillUrl: string | null;
  status: string;
  year?: string | null;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="titles-catalog-rail-card flex w-[140px] shrink-0 snap-start flex-col gap-[var(--space-2)]"
      data-titles-catalog-rail-card=""
      data-title-status={status}
    >
      <div
        className="relative h-[210px] w-[140px] overflow-hidden rounded-[12px] bg-surface-muted [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_img]:object-center"
        data-titles-catalog-rail-frame=""
        data-titles-catalog-crop="cover"
      >
        {stillUrl ? (
          <Artwork
            src={stillUrl}
            title={title}
            rounded="rounded-none"
            className="absolute inset-0 h-full w-full"
            sizes="140px"
          />
        ) : (
          <div className="absolute inset-0 bg-surface-muted" data-titles-catalog-empty-art="" />
        )}
      </div>
      <div
        className="flex w-[140px] flex-col overflow-hidden"
        data-titles-catalog-rail-stack=""
      >
        <span
          className="min-w-0 truncate t-body text-ink"
          data-titles-catalog-rail-name=""
        >
          {title}
        </span>
        {year ? (
          <span className="t-body-sm font-normal text-ink-2" data-titles-catalog-rail-year="">
            {year}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

export function TitlesCatalogStill({
  href,
  title,
  stillUrl,
  status,
  statusLabel,
  year,
}: {
  href: string;
  title: string;
  stillUrl: string | null;
  status: string;
  statusLabel: string;
  year?: string | null;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="titles-catalog-card flex flex-col gap-[var(--space-3)]"
      data-titles-catalog-card=""
      data-title-status={status}
    >
      <div
        className="relative aspect-[2/3] w-full overflow-hidden rounded-[var(--radius-lg)] bg-surface-muted [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_img]:object-center"
        data-titles-catalog-frame=""
        data-titles-catalog-crop="cover"
      >
        {stillUrl ? (
          <Artwork
            src={stillUrl}
            title={title}
            rounded="rounded-none"
            className="absolute inset-0 h-full w-full"
            sizes="(max-width: 768px) 140px, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw"
          />
        ) : (
          <div className="absolute inset-0 bg-surface-muted" data-titles-catalog-empty-art="" />
        )}
      </div>
      <div
        className="flex flex-col gap-[var(--space-1)]"
        data-titles-catalog-stack=""
      >
        <span
          className="min-w-0 truncate t-body-sm font-medium text-ink"
          data-titles-catalog-name=""
        >
          {title}
        </span>
        <div
          className="flex min-w-0 flex-wrap items-center gap-x-[var(--space-2)] gap-y-[var(--space-1)]"
          data-titles-catalog-meta=""
        >
          {year ? (
            <span className="t-body-sm font-normal text-ink-3" data-titles-catalog-year="">
              {year}
            </span>
          ) : null}
          <span
            className="inline-flex w-fit items-center rounded-full border border-hairline px-[var(--space-3)] py-[var(--space-1)] t-body-sm font-normal text-ink-2"
            data-titles-catalog-status=""
          >
            {statusLabel}
          </span>
        </div>
      </div>
    </Link>
  );
}
