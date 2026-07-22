import { cn } from "@/lib/cn";

// The ONE stat/KPI primitive (layout standard). Reconciles the old unused StatTile
// and the hero's inline HeroStat into a single component that works on both the light
// surface and the charcoal band (surface='band'). Figures are always tabular (t-data)
// and align on a grid — ledger-grade, per the Mercury/Coinbase bar.

type Surface = "default" | "band";

const LABEL: Record<Surface, string> = {
  default: "text-ink-3",
  band: "text-band-ink/50",
};
const VALUE: Record<Surface, string> = {
  default: "text-ink",
  band: "text-band-ink",
};
const VALUE_MUTED: Record<Surface, string> = {
  default: "text-ink-3",
  band: "text-band-ink/40",
};
const META: Record<Surface, string> = {
  default: "text-ink-3",
  band: "text-band-ink/60",
};

export function Stat({
  label,
  value,
  meta,
  surface = "default",
  muted = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  meta?: React.ReactNode;
  surface?: Surface;
  muted?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 px-4 py-3",
        surface === "band" ? "bg-band" : "bg-surface",
        className,
      )}
    >
      <dt className={cn("t-label", LABEL[surface])}>{label}</dt>
      <dd
        className={cn(
          "t-data text-2xl font-medium leading-none",
          muted ? VALUE_MUTED[surface] : VALUE[surface],
        )}
      >
        {value}
      </dd>
      {meta ? <div className={cn("t-body-sm", META[surface])}>{meta}</div> : null}
    </div>
  );
}

// A row/grid of Stats with hairline dividers between cells (gap-px over a subtle
// fill). Matches the hero's stats row so the two are literally the same primitive.
export function StatGrid({
  surface = "default",
  className,
  children,
}: {
  surface?: Surface;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] sm:grid-cols-4",
        surface === "band" ? "bg-band-ink/[0.06]" : "bg-hairline",
        className,
      )}
    >
      {children}
    </dl>
  );
}
