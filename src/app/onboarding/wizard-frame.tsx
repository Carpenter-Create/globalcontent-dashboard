import Link from "next/link";

// Full-screen onboarding chrome (no AppShell): GC wordmark + a thin proportional
// progress bar + a titled content column. One decision per screen. Neutral tokens
// only (no accent/purple on the progress fill) — accent is a placeholder pending logo.
const TOTAL_STEPS = 5;

export function WizardFrame({
  step,
  eyebrow,
  title,
  subtitle,
  back,
  children,
}: {
  step: number;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  back?: string;
  children: React.ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, Math.round((step / TOTAL_STEPS) * 100)));
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="flex items-center justify-between gap-6 px-6 py-5">
        <span className="t-label tracking-wide text-ink-2">GLOBAL CONTENT</span>
        <div
          className="h-1 w-40 overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${pct}%` }} />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-12">
        <div className="flex flex-col gap-2">
          {eyebrow ? <span className="t-label text-ink-3">{eyebrow}</span> : null}
          <h1 className="t-subhead text-ink">{title}</h1>
          {subtitle ? <p className="t-body-sm text-body">{subtitle}</p> : null}
        </div>

        {children}

        {back ? (
          <Link href={back} className="t-body-sm text-ink-3 transition-colors hover:text-ink-2">
            ← Back
          </Link>
        ) : null}
      </main>
    </div>
  );
}
