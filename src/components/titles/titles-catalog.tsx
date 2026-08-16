import Link from "next/link";

import { Artwork } from "@/components/layout/artwork";
import { cn } from "@/lib/cn";
import { TITLES_CATALOG } from "@/lib/titles-catalog";

// Client `/titles` chrome only. Not the shared Card, BannerCard, or DataTable —
// those must not restyle home, Deliveries, Catalog Health, or staff surfaces.
// Catalog you operate: art is the canvas; search, Add Title, and status stay chrome.

export function TitlesCatalogFrame({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "titles-catalog mx-auto flex w-full flex-col gap-[var(--space-10)] px-[var(--space-6)] pt-[var(--space-8)] sm:px-[var(--space-10)]",
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
    <header className="titles-catalog-header flex flex-col gap-[var(--space-6)] sm:flex-row sm:items-center sm:justify-between">
      <h1 className="t-section text-ink">{TITLES_CATALOG.title}</h1>
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
      className="titles-catalog-grid grid grid-cols-1 gap-x-[var(--space-6)] gap-y-[var(--space-10)] lg:grid-cols-3"
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
        className="relative aspect-[2/3] w-full overflow-hidden rounded-[var(--radius-lg)] border border-hairline bg-surface-muted"
        data-titles-catalog-frame=""
      >
        {stillUrl ? (
          <Artwork
            src={stillUrl}
            title={title}
            rounded="rounded-none"
            className="h-full w-full"
            sizes="(max-width: 1024px) 100vw, 33vw"
          />
        ) : (
          <div className="h-full w-full bg-surface-muted" data-titles-catalog-empty-art="" />
        )}
      </div>
      <div className="flex flex-col gap-[var(--space-2)]">
        <span className="min-w-0 truncate t-body font-medium text-ink transition-colors group-hover:text-ink-2">
          {title}
        </span>
        <span
          className="inline-flex w-fit items-center rounded-full bg-surface-muted px-[var(--space-3)] py-[var(--space-1)] t-body-sm text-ink-2"
          data-titles-catalog-status=""
        >
          {statusLabel}
        </span>
      </div>
    </Link>
  );
}
