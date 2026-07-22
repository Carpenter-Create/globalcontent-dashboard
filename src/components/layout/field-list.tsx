import { cn } from "@/lib/cn";

// Canonical label/value ledger (Metadata register). Frameless — meant to sit inside a
// Card (which supplies the surface/border), directly after the CardHeader, so its
// hairline row dividers run full-width. Right-aligned values.
export function FieldList({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("divide-y divide-hairline", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-baseline justify-between gap-6 px-5 py-3">
          <dt className="shrink-0 t-body-sm text-ink-3">{it.label}</dt>
          <dd className="t-body-sm text-ink text-right">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
