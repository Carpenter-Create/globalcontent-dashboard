import Link from "next/link";
import { LayoutGrid, Rows3 } from "lucide-react";

import { cn } from "@/lib/cn";
import type { View } from "@/lib/catalog-view";

// Poster-grid ⇄ table switch (layout standard). URL-driven (server-read), so it's just
// two links — no client JS. Lives in the PageHeader actions.
export function ViewToggle({
  current,
  gridHref,
  tableHref,
}: {
  current: View;
  gridHref: string;
  tableHref: string;
}) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-hairline bg-surface p-0.5"
      role="group"
      aria-label="View"
    >
      <ViewLink href={gridHref} active={current === "grid"} label="Poster grid">
        <LayoutGrid className="h-4 w-4" strokeWidth={1.5} />
      </ViewLink>
      <ViewLink href={tableHref} active={current === "table"} label="Table">
        <Rows3 className="h-4 w-4" strokeWidth={1.5} />
      </ViewLink>
    </div>
  );
}

function ViewLink({
  href,
  active,
  label,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
        active ? "bg-surface-muted text-ink" : "text-ink-3 hover:text-ink-2",
      )}
    >
      {children}
    </Link>
  );
}
