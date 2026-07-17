import { cn } from "@/lib/cn";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("t-label text-ink-2", className)} {...props} />;
}
