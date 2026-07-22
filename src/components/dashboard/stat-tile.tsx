import Link from "next/link";

import { Card, CardBody } from "@/components/ui/card";
import { cn } from "@/lib/cn";

// A portfolio-snapshot tile: eyebrow label, one big figure (mono/tabular via
// .t-data), optional meta line. Optional href makes the whole tile a link.
// Server-component-safe and shared — the future GC aggregate Dashboard reuses it.
export function StatTile({
  label,
  value,
  meta,
  href,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  meta?: React.ReactNode;
  href?: string;
  tone?: "default" | "muted";
}) {
  const body = (
    <CardBody className="flex flex-col gap-1">
      <span className="t-label text-ink-3">{label}</span>
      <span
        className={cn(
          "t-data text-3xl font-medium leading-none",
          tone === "muted" ? "text-ink-3" : "text-ink",
        )}
      >
        {value}
      </span>
      {meta ? <span className="t-body-sm text-ink-3">{meta}</span> : null}
    </CardBody>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        <Card className="h-full transition-colors hover:border-accent">{body}</Card>
      </Link>
    );
  }
  return <Card className="h-full">{body}</Card>;
}
