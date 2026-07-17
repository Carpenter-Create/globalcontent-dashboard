import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/cn";

// Ported from watershedportal PageHeader — proportions kept, rethemed: GC `.t-*`
// type (not the Watershed serif `.page-title`), token colors.
type Props = {
  title: string;
  subtitle?: string;
  backLink?: { href: string; label?: string };
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({ title, subtitle, backLink, actions, className }: Props) {
  return (
    <div className={cn("flex items-start justify-between gap-4 pb-6", className)}>
      <div className="flex flex-col gap-1">
        {backLink ? (
          <Link
            href={backLink.href}
            className="inline-flex items-center gap-1 t-body-sm text-ink-3 transition-colors hover:text-ink-2"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
            {backLink.label ?? "Back"}
          </Link>
        ) : null}
        <h1 className="t-subhead text-ink">{title}</h1>
        {subtitle ? <p className="t-body-sm text-ink-3">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
    </div>
  );
}
