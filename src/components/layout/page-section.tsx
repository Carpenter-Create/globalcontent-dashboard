import { cn } from "@/lib/cn";

// A page is composed of PageSections (layout standard). One section header idiom,
// one rhythm. Replaces the ad-hoc `<div class="mt-3/6">` + bare `<h2>`/`t-label`
// scattered across surfaces. Wrap the page's sections in <PageStack> for spacing.

export function PageStack({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-8", className)} {...props} />;
}

export function PageSection({
  title,
  eyebrow,
  description,
  actions,
  className,
  children,
}: {
  title?: string;
  eyebrow?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const hasHeader = title || eyebrow || description || actions;
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      {hasHeader ? (
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            {eyebrow ? <span className="t-label text-ink-3">{eyebrow}</span> : null}
            {title ? <h2 className="t-body font-medium text-ink">{title}</h2> : null}
            {description ? <p className="t-body-sm text-ink-3">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
