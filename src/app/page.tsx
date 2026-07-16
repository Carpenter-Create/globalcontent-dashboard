import { ThemeToggle } from "@/components/theme-toggle";

// Design-system preview — NOT a product feature. Renders the ported register
// (tokens, type scale, hairlines, the one placeholder accent) so the system is
// verifiable in light and dark. Replace with real product UI later.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="t-label text-ink-3">Design system</span>
          <h1 className="t-title text-ink">Global Content</h1>
          <p className="t-lead text-body">
            House register ported: greyscale neutral ramp, one placeholder
            accent, Geist type scale. Light default, dark on toggle.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <section className="flex flex-col gap-3">
        <span className="t-label text-ink-3">Surfaces &amp; hairlines</span>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-[var(--radius)] border border-hairline bg-canvas p-4 t-body-sm text-ink-2">canvas</div>
          <div className="rounded-[var(--radius)] border border-hairline bg-surface p-4 t-body-sm text-ink-2">surface</div>
          <div className="rounded-[var(--radius)] border border-hairline bg-surface-muted p-4 t-body-sm text-ink-2">surface-muted</div>
        </div>
        <div className="rounded-[var(--radius)] bg-band p-4 t-body-sm text-band-ink">band</div>
      </section>

      <section className="flex flex-col gap-3">
        <span className="t-label text-ink-3">The one accent (placeholder)</span>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-[var(--radius-sm)] bg-accent px-4 py-2 t-body-sm font-medium text-accent-contrast"
          >
            Primary action
          </button>
          <span className="t-data text-accent">accent link</span>
          <span className="t-data text-ink-2">1,204,530</span>
        </div>
      </section>
    </main>
  );
}
