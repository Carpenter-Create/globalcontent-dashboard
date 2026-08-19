export default function Loading() {
  return (
    <div className="flex min-h-64 flex-col gap-[var(--space-6)]">
      <div className="h-8 w-36 rounded-[var(--radius-sm)] bg-surface-muted" />
      <div className="flex flex-1 flex-col items-center justify-center gap-[var(--space-4)]">
        <div className="h-12 w-64 rounded-[var(--radius-sm)] bg-surface-muted" />
        <div className="h-32 w-full max-w-[640px] rounded-[var(--radius-lg)] border border-hairline bg-surface" />
      </div>
    </div>
  );
}
