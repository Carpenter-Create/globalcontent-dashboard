"use client";

import { useEffect } from "react";

import { ASK_GLOBEE } from "@/lib/ask-globee";

export function AskGlobeeThinking({ onStop }: { onStop: () => void }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onStop();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onStop]);

  return (
    <div data-ask-globee-thinking="" className="flex items-start gap-[var(--space-2)]">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[length:var(--text-xs)] font-medium text-accent-contrast">
        {ASK_GLOBEE.globeeMark}
      </div>
      <div className="flex w-full max-w-[640px] items-center justify-between gap-[var(--space-4)]">
        <p className="t-body text-ink-2">{ASK_GLOBEE.thinking}</p>
        <button type="button" data-ask-globee-stop="" onClick={onStop} className="t-body-sm text-ink-3">
          {ASK_GLOBEE.stop}
          <span className="ml-[var(--space-2)]">{ASK_GLOBEE.stopHint}</span>
        </button>
      </div>
    </div>
  );
}
