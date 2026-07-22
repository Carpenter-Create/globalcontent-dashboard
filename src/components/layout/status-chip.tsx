import { cn } from "@/lib/cn";

// A restrained status pill (layout standard). Greyscale by default — GC has no status
// colors — with the accent reserved for the "active/live" state (echoes the site's
// filled-accent node in the Rights→…→Payments stepper). One dot + one label.
type Tone = "neutral" | "active" | "muted";

export function StatusChip({
  label,
  tone = "neutral",
  className,
}: {
  label: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 t-label",
        tone === "muted" ? "text-ink-3" : "text-ink-2",
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "active" ? "bg-accent" : tone === "muted" ? "bg-ink-3/40" : "bg-ink-3",
        )}
      />
      {label}
    </span>
  );
}
