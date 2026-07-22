// A horizontal-scroll row of cards (streaming rail, Visual register). Children are
// fixed-width cells. Scrollbar hidden; snap for a native feel. Bleeds to the page edge
// (-mx-6 matches the shell's px-6 inset) so posters scroll off-screen like Netflix.
export function Rail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="t-label text-ink-3">{label}</h2>
      <div className="no-scrollbar -mx-6 flex snap-x gap-4 overflow-x-auto px-6 pb-2">
        {children}
      </div>
    </section>
  );
}
