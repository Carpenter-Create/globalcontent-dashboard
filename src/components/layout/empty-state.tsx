import { cn } from "@/lib/cn";

// The ONE empty state (layout standard). Formalizes the single-Card empty pattern
// that was already the one consistent thing app-wide — now designed: a centered,
// calm block with an optional icon, a headline, a muted line, and an optional action.
// Restrained, not a bare "No titles yet." card.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-hairline bg-surface px-6 py-14 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted text-ink-3">
          <Icon className="h-5 w-5" strokeWidth={1.5} />
        </span>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="t-body font-medium text-ink">{title}</p>
        {description ? <p className="t-body-sm text-ink-3">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
