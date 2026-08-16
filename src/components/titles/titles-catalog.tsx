import Link from "next/link";

import { Artwork } from "@/components/layout/artwork";
import { cn } from "@/lib/cn";
import { TITLES_CATALOG } from "@/lib/titles-catalog";

// Client `/titles` chrome only. Not the shared Card, BannerCard, or DataTable —
// those must not restyle home, Deliveries, Catalog Health, or staff surfaces.
// Operate bar sits under the title. Each title is a hairline/surface card:
// 2:3 still, then one designed stack — title, year, TITLE_STATUS_LABELS pill.
// Hierarchy is weight, not color. Accent is Add Title only.
// Page-local still crop: every catalog img is object-cover / object-center
// inside the 2:3 frame so Artwork's default treatment cannot diverge.

export function TitlesCatalogFrame({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "titles-catalog mx-auto flex w-full flex-col gap-[var(--space-6)] px-[var(--space-6)] pt-[var(--space-8)] sm:px-[var(--space-10)]",
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
}: {
  action?: React.ReactNode;
}) {
  return (
    <header className="titles-catalog-header flex flex-col gap-[var(--space-6)]">
      <h1 className="t-section text-ink">{TITLES_CATALOG.title}</h1>
      {action ? (
        <div
          className="titles-catalog-operate flex w-full items-center justify-between gap-[var(--space-3)]"
          data-titles-catalog-operate=""
        >
          {action}
        </div>
      ) : null}
    </header>
  );
}

export function TitlesCatalogEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="titles-catalog-empty py-[var(--space-16)]">
      <p className="t-body text-ink-2">{children}</p>
    </div>
  );
}

export function TitlesCatalogGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="titles-catalog-grid grid grid-cols-1 gap-x-[var(--space-6)] gap-y-[var(--space-10)] sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      data-titles-catalog-grid=""
    >
      {children}
    </div>
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
      className="titles-catalog-card group flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-hairline bg-surface"
      data-titles-catalog-card=""
      data-title-status={status}
    >
      <div
        className="relative aspect-[2/3] w-full overflow-hidden bg-surface-muted [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_img]:object-center"
        data-titles-catalog-frame=""
        data-titles-catalog-crop="cover"
      >
        {stillUrl ? (
          <Artwork
            src={stillUrl}
            title={title}
            rounded="rounded-none"
            className="absolute inset-0 h-full w-full"
            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw"
          />
        ) : (
          <div className="absolute inset-0 bg-surface-muted" data-titles-catalog-empty-art="" />
        )}
      </div>
      <div
        className="flex flex-col gap-[var(--space-1)] px-[var(--space-4)] pb-[var(--space-4)] pt-[var(--space-3)]"
        data-titles-catalog-stack=""
      >
        <span className="min-w-0 truncate t-body font-medium text-ink">
          {title}
        </span>
        {year ? (
          <span className="t-body-sm font-normal text-ink-2" data-titles-catalog-year="">
            {year}
          </span>
        ) : null}
        <span
          className="mt-[var(--space-1)] inline-flex w-fit items-center rounded-full bg-surface-muted px-[var(--space-3)] py-[var(--space-1)] t-body-sm font-normal text-ink"
          data-titles-catalog-status=""
        >
          {statusLabel}
        </span>
      </div>
    </Link>
  );
}
