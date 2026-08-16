import Link from "next/link";

import { Artwork } from "@/components/layout/artwork";
import { cn } from "@/lib/cn";
import { TITLES_CATALOG } from "@/lib/titles-catalog";

// Client `/titles` chrome only. Not the shared Card, BannerCard, or DataTable —
// those must not restyle home, Deliveries, Catalog Health, or staff surfaces.

export function TitlesCatalogFrame({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "titles-catalog mx-auto flex w-full flex-col gap-[var(--space-10)] px-6 pt-8 sm:px-10",
        className,
      )}
      style={{ maxWidth: "var(--content-max)" }}
      data-titles-catalog=""
      {...props}
    />
  );
}

export function TitlesCatalogHeader({
  meta,
  action,
}: {
  meta: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="titles-catalog-header flex flex-col gap-[var(--space-6)] sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="t-section text-ink">{TITLES_CATALOG.title}</h1>
        <p className="mt-[var(--space-3)] t-body-sm text-ink-3">{meta}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
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
      className="titles-catalog-grid grid grid-cols-1 gap-x-[var(--space-8)] gap-y-[var(--space-10)] lg:grid-cols-2"
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
}: {
  href: string;
  title: string;
  stillUrl: string | null;
  status: string;
  statusLabel: string;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="titles-catalog-still group flex flex-col gap-[var(--space-4)]"
      data-titles-catalog-still=""
      data-title-status={status}
    >
      <div
        className="relative aspect-[16/9] w-full overflow-hidden rounded-[var(--radius-lg)] border border-hairline bg-surface-muted"
        data-titles-catalog-frame=""
      >
        {stillUrl ? (
          <Artwork
            src={stillUrl}
            title={title}
            rounded="rounded-none"
            className="h-full w-full"
            sizes="(max-width: 1024px) 100vw, 50vw"
          />
        ) : (
          <div className="h-full w-full bg-surface-muted" data-titles-catalog-empty-art="" />
        )}
      </div>
      <div className="flex items-baseline justify-between gap-[var(--space-6)]">
        <span className="min-w-0 truncate t-body font-medium text-ink transition-colors group-hover:text-ink-2">
          {title}
        </span>
        <span className="t-label shrink-0 text-ink-3" data-titles-catalog-status="">
          {statusLabel}
        </span>
      </div>
    </Link>
  );
}
