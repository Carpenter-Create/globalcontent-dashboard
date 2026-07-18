import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";

// Geometry from tokens (radius, type scale, accent) — never hardcoded px/hex.
// Keyboard focus is the global accent :focus-visible ring (globals.css).
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-contrast hover:opacity-90",
  secondary: "border border-hairline bg-surface text-ink-2 hover:bg-surface-muted",
  ghost: "text-ink-2 hover:bg-surface-muted",
};

export function Button({
  className,
  variant = "primary",
  type = "button",
  ...props
}: React.ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 t-body-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
