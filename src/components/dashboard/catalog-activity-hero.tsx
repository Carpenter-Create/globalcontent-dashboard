"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import {
  CATALOG_RANGES,
  RANGE_WORD,
  cumulativeCatalogSeries,
  type CatalogRange,
} from "@/lib/catalog-activity";

// ── The Dashboard hero ─────────────────────────────────────────────────────
// A single charcoal band (--band, a sanctioned greyscale surface — not a colour)
// carrying ONE data-viz: cumulative catalog size over time, drawn as an accent
// area chart with a range selector, a playhead on the latest point, and a stats
// row beneath. Follows the dataviz method: single series → no legend (the title
// names it), one axis, sequential single hue (the accent), thin 2px marks, a
// recessive grid, a crosshair+tooltip hover layer, and an sr-only table view.
//
// PROVENANCE: the curve is REAL — cumulative count of titles by created_at, not a
// placeholder. Brand rule: never invent stats. When a catalog has no titles yet
// the chart says so plainly rather than faking a line.

export type CatalogActivityHeroProps = {
  /** Sorted-ascending title creation timestamps (ms since epoch). */
  createdAt: number[];
  /** Server "now" (ms) — passed in so range windows agree across SSR/CSR. */
  nowMs: number;
  /** Live snapshot figures for the stats row. */
  stats: {
    catalog: number;
    upcoming: number;
    live: number;
    /** Revenue is a seam until statements land — pass a dash. */
    revenue: React.ReactNode;
  };
};

// Geometry for the plotted SVG area (px, within the measured container width).
const H = 200;
const PAD = { top: 16, right: 14, bottom: 26, left: 14 };

export function CatalogActivityHero({ createdAt, nowMs, stats }: CatalogActivityHeroProps) {
  const [range, setRange] = useState<CatalogRange>("1y");
  // Measure width client-side (crisp strokes + accurate hover math). We only draw
  // the SVG once measured, so SSR and first client paint never disagree.
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const days = CATALOG_RANGES.find((r) => r.key === range)!.days;

  // Build the cumulative series for the selected window (pure lib fn; real data).
  const series = useMemo(
    () => cumulativeCatalogSeries(createdAt, nowMs, days),
    [createdAt, nowMs, days],
  );

  // Map data → pixels once we know the width.
  const geom = useMemo(() => {
    if (!series || width == null) return null;
    const w = width;
    const innerW = Math.max(w - PAD.left - PAD.right, 1);
    const innerH = H - PAD.top - PAD.bottom;
    const { points, start, yMax } = series;
    const span = Math.max(nowMs - start, 1);
    // A little headroom above the peak so the playhead dot never clips the top.
    const yTop = yMax * 1.12;

    const px = (t: number) => PAD.left + ((t - start) / span) * innerW;
    const py = (c: number) => PAD.top + innerH - (c / yTop) * innerH;

    const xy = points.map((p) => ({ x: px(p.t), y: py(p.c), ...p }));
    const line = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
    const baseY = PAD.top + innerH;
    const area = `${line} L${xy[xy.length - 1].x.toFixed(2)},${baseY} L${xy[0].x.toFixed(2)},${baseY} Z`;

    // 4 evenly spaced date ticks across the window.
    const ticks = Array.from({ length: 4 }, (_, i) => {
      const t = start + (span * i) / 3;
      return { x: px(t), t };
    });

    return { xy, line, area, baseY, innerH, px, py, ticks, w };
  }, [series, width, nowMs]);

  const tickFmt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", days <= 90 ? { month: "short", day: "numeric" } : { month: "short" }),
    [days],
  );
  const fullFmt = useMemo(() => new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }), []);

  // Nearest point to the hovered x (for the crosshair + tooltip).
  const hover = useMemo(() => {
    if (!geom || hoverX == null) return null;
    let best = geom.xy[0];
    for (const p of geom.xy) if (Math.abs(p.x - hoverX) < Math.abs(best.x - hoverX)) best = p;
    return best;
  }, [geom, hoverX]);

  const hasData = series != null;

  return (
    <section
      className="rounded-[var(--radius-lg)] bg-band px-6 py-6 text-band-ink sm:px-8 sm:py-7"
      aria-label="Catalog activity"
    >
      {/* Headline + range selector */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="t-label text-band-ink/50">Catalog activity</span>
          <span className="t-data text-4xl font-medium leading-none sm:text-5xl">
            {stats.catalog}
          </span>
          <span className="t-body-sm text-band-ink/60">
            {hasData && series!.added > 0 ? (
              <>
                <span className="text-accent" aria-hidden>
                  ▲
                </span>{" "}
                +{series!.added} {RANGE_WORD[range]}
              </>
            ) : (
              `No new titles ${RANGE_WORD[range]}`
            )}
          </span>
        </div>

        <div
          className="flex shrink-0 items-center gap-1 rounded-full bg-band-ink/[0.08] p-1"
          role="group"
          aria-label="Chart range"
        >
          {CATALOG_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              className={cn(
                "rounded-full px-3 py-1 t-label transition-colors",
                range === r.key
                  ? "bg-band-ink/[0.14] text-band-ink"
                  : "text-band-ink/50 hover:text-band-ink/80",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* The chart */}
      <div ref={plotRef} className="relative mt-5" style={{ height: H }}>
        {!hasData ? (
          <div className="flex h-full items-center justify-center text-center">
            <p className="t-body-sm text-band-ink/60">
              Your catalog activity charts here as titles are added.
            </p>
          </div>
        ) : geom ? (
          <>
            <svg
              width={geom.w}
              height={H}
              viewBox={`0 0 ${geom.w} ${H}`}
              className="block"
              style={{ color: "var(--accent)" }}
              role="img"
              aria-label={`Cumulative catalog size ${RANGE_WORD[range]}: ${series!.total} titles as of ${fullFmt.format(new Date(nowMs))}.`}
              onPointerMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoverX(e.clientX - rect.left);
              }}
              onPointerLeave={() => setHoverX(null)}
            >
              <defs>
                <linearGradient id="gc-catalog-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Recessive gridlines (band-ink, very low opacity) */}
              {[0.5, 1].map((f) => {
                const y = PAD.top + geom.innerH * (1 - f);
                return (
                  <line
                    key={f}
                    x1={PAD.left}
                    x2={geom.w - PAD.right}
                    y1={y}
                    y2={y}
                    stroke="var(--band-ink)"
                    strokeOpacity={0.08}
                    strokeWidth={1}
                  />
                );
              })}

              <path d={geom.area} fill="url(#gc-catalog-fill)" />
              <path
                d={geom.line}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />

              {/* Crosshair on hover */}
              {hover ? (
                <line
                  x1={hover.x}
                  x2={hover.x}
                  y1={PAD.top}
                  y2={geom.baseY}
                  stroke="var(--band-ink)"
                  strokeOpacity={0.25}
                  strokeWidth={1}
                />
              ) : null}

              {/* Playhead — the latest point */}
              {(() => {
                const last = geom.xy[geom.xy.length - 1];
                return (
                  <>
                    <line
                      x1={last.x}
                      x2={last.x}
                      y1={PAD.top}
                      y2={geom.baseY}
                      stroke="currentColor"
                      strokeOpacity={0.35}
                      strokeWidth={1}
                    />
                    <circle cx={last.x} cy={last.y} r={5} fill="currentColor" />
                    <circle cx={last.x} cy={last.y} r={5} fill="none" stroke="var(--band)" strokeWidth={2} />
                  </>
                );
              })()}

              {/* Hovered marker */}
              {hover ? (
                <circle cx={hover.x} cy={hover.y} r={4} fill="var(--band-ink)" />
              ) : null}

              {/* Month axis */}
              {geom.ticks.map((tk, i) => (
                <text
                  key={i}
                  x={tk.x}
                  y={H - 8}
                  textAnchor={i === 0 ? "start" : i === geom.ticks.length - 1 ? "end" : "middle"}
                  className="t-data"
                  fontSize={11}
                  fill="var(--band-ink)"
                  fillOpacity={0.45}
                >
                  {tickFmt.format(new Date(tk.t))}
                </text>
              ))}
            </svg>

            {/* Tooltip (HTML overlay so text stays crisp) */}
            {hover ? (
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-[var(--radius-sm)] border border-band-ink/10 bg-band px-2.5 py-1.5 shadow-lg"
                style={{ left: Math.min(Math.max(hover.x, 60), geom.w - 60), top: hover.y - 8 }}
              >
                <div className="t-data text-sm font-medium text-band-ink">{hover.c} titles</div>
                <div className="t-body-sm text-band-ink/60">{fullFmt.format(new Date(hover.t))}</div>
              </div>
            ) : null}
          </>
        ) : (
          // Measuring — reserve the height to avoid layout shift.
          <div className="h-full" aria-hidden />
        )}

        {/* sr-only table view (dataviz a11y: identity/values never color-alone) */}
        {hasData ? (
          <table className="sr-only">
            <caption>Cumulative catalog size {RANGE_WORD[range]}</caption>
            <thead>
              <tr>
                <th>Date</th>
                <th>Titles</th>
              </tr>
            </thead>
            <tbody>
              {series!.points.map((p, i) => (
                <tr key={i}>
                  <td>{fullFmt.format(new Date(p.t))}</td>
                  <td>{p.c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      {/* Stats row */}
      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius)] bg-band-ink/[0.06] sm:grid-cols-4">
        <HeroStat label="Catalog" value={stats.catalog} />
        <HeroStat label="Upcoming" value={stats.upcoming} />
        <HeroStat label="Live" value={stats.live} />
        <HeroStat label="Revenue" value={stats.revenue} muted />
      </dl>
    </section>
  );
}

function HeroStat({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 bg-band px-4 py-3">
      <dt className="t-label text-band-ink/50">{label}</dt>
      <dd className={cn("t-data text-2xl font-medium leading-none", muted ? "text-band-ink/40" : "text-band-ink")}>
        {value}
      </dd>
    </div>
  );
}
