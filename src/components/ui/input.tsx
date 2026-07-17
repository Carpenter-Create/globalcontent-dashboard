import { cn } from "@/lib/cn";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "w-full rounded-[var(--radius-sm)] border border-hairline bg-surface px-3 py-2 t-body text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}
