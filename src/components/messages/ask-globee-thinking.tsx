import { ASK_GLOBEE, askGlobeeThinkingVerb } from "@/lib/ask-globee";

// 427:352 empty-lead thinking, or 427:440 handoff once a live lead exists.
// Catalog verbs are chrome, not persisted conversation_messages rows.
export function AskGlobeeThinking({ lead = null }: { lead?: string | null }) {
  const liveLead = lead?.trim() || null;
  const verb = askGlobeeThinkingVerb(liveLead);

  return (
    <div
      data-ask-globee-thinking=""
      data-ask-globee-handoff={liveLead ? "" : undefined}
      className="flex items-start gap-[var(--space-2)]"
    >
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[length:var(--text-xs)] font-medium text-accent-contrast">
        {ASK_GLOBEE.globeeMark}
      </div>
      <div className="flex w-full max-w-[640px] flex-col">
        {liveLead ? (
          <p className="t-body leading-6 text-ink">{liveLead}</p>
        ) : (
          <div data-ask-globee-lead-slot="" className="min-h-6" />
        )}
        <p
          data-ask-globee-thinking-verb=""
          className={liveLead ? "t-body-sm text-ink-3/55" : "t-body-sm text-ink-3"}
        >
          {verb}
        </p>
      </div>
    </div>
  );
}
