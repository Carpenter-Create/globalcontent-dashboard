import { cn } from "@/lib/cn";

// Flat by default (border + surface) — the calm, restrained register.
// Elevation token exists (--elevation) for surfaces that need to lift; opt in per use.
export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-hairline bg-surface p-4",
        className,
      )}
      {...props}
    />
  );
}
