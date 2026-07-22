import { cn } from "@/lib/cn";

// The canonical label/value list (Metadata register) — a clean ledger-style block of
// facts. Replaces the ad-hoc metadata renderings. Right-aligned values, tabular where
// numeric. `value` may be any node (a chip, a link, a copyable ref).
export function FieldList({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode }[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "divide-y divide-hairline overflow-hidden rounded-[var(--radius-lg)] border border-hairline bg-surface",
        className,
      )}
    >
      {items.map((it, i) => (
        <div key={i} className="flex items-baseline justify-between gap-6 px-5 py-3">
          <dt className="shrink-0 t-body-sm text-ink-3">{it.label}</dt>
          <dd className="t-body-sm text-ink text-right">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
