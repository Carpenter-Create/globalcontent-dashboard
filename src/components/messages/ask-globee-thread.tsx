"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Copy,
  Download,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import { ASK_GLOBEE, askGlobeeComposerSubmit, askGlobeeThreadHref } from "@/lib/ask-globee";
import type { AskGlobeeAnswer } from "@/lib/ask-globee-answer";

function ThreadIconButton({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex size-6 items-center justify-center text-ink-3"
    >
      {children}
    </button>
  );
}

export function AskGlobeeThread({
  initials,
  prompt,
  answer,
}: {
  initials: string;
  prompt: string;
  answer: AskGlobeeAnswer;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");

  return (
    <div data-ask-globee-thread="" className="flex min-h-[min(36rem,calc(100dvh-var(--header-height)-var(--content-inset)*2))] flex-col">
      <div className="flex flex-1 flex-col gap-[var(--space-4)]">
        <div
          data-ask-globee-conversation=""
          className="flex flex-1 flex-col gap-[var(--space-16)] px-[var(--content-inset)]"
        >
          <div data-ask-globee-user-row="" className="flex items-start gap-[var(--space-2)]">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[length:var(--text-xs)] font-medium text-ink">
              {initials}
            </div>
            <div className="rounded-[var(--radius-lg)] bg-surface-muted p-[var(--space-4)]">
              <p className="t-body text-ink">{prompt}</p>
            </div>
          </div>

          <div data-ask-globee-answer="" className="flex items-start gap-[var(--space-2)]">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[length:var(--text-xs)] font-medium text-accent-contrast">
              {ASK_GLOBEE.globeeMark}
            </div>
            <div className="flex w-full max-w-[640px] flex-col gap-[var(--space-2)]">
              <p className="t-body text-ink">{answer.lead}</p>
              {answer.follow ? <p className="t-body-sm text-ink-2">{answer.follow}</p> : null}
              <div className="flex flex-wrap items-center gap-[var(--space-4)]">
                <p className="t-body-sm text-ink-3">{ASK_GLOBEE.attributionName}</p>
                <div className="flex items-center gap-[var(--space-4)]">
                  <ThreadIconButton label={ASK_GLOBEE.copyLabel}>
                    <Copy className="size-4" strokeWidth={1.33} />
                  </ThreadIconButton>
                  <ThreadIconButton label={ASK_GLOBEE.downloadLabel}>
                    <Download className="size-4" strokeWidth={1.33} />
                  </ThreadIconButton>
                  <ThreadIconButton label={ASK_GLOBEE.thumbsUpLabel}>
                    <ThumbsUp className="size-4" strokeWidth={1.33} />
                  </ThreadIconButton>
                  <ThreadIconButton label={ASK_GLOBEE.thumbsDownLabel}>
                    <ThumbsDown className="size-4" strokeWidth={1.33} />
                  </ThreadIconButton>
                </div>
              </div>
            </div>
          </div>
        </div>

        <form
          data-ask-globee-composer=""
          className="flex justify-center"
          onSubmit={(event) => {
            event.preventDefault();
            const next = askGlobeeComposerSubmit(draft);
            const href = next ? askGlobeeThreadHref(next) : null;
            if (href) router.replace(href);
          }}
        >
          <label className="flex h-14 w-full max-w-[640px] items-center justify-between rounded-full border border-hairline bg-surface px-[var(--space-4)]">
            <span className="sr-only">{ASK_GLOBEE.composerPlaceholder}</span>
            <input
              type="text"
              name="prompt"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={ASK_GLOBEE.composerPlaceholder}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent t-body-sm text-ink placeholder:text-ink-3 focus:outline-none"
            />
            <button
              type="submit"
              aria-label={ASK_GLOBEE.sendLabel}
              className="flex size-4 shrink-0 items-center justify-center text-ink-3"
            >
              <ArrowRight className="size-4" strokeWidth={1.33} />
            </button>
          </label>
        </form>
      </div>
    </div>
  );
}
