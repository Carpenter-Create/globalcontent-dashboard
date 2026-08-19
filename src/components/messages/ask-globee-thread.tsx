"use client";

import {
  ArrowRight,
  ChevronLeft,
  Copy,
  Download,
  MoreHorizontal,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import { AppHeaderLeading } from "@/components/chrome/app-header-leading";
import { ASK_GLOBEE } from "@/lib/ask-globee";

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

export function AskGlobeeThread({ initials }: { initials: string }) {
  return (
    <div data-ask-globee-thread="" className="flex min-h-[min(36rem,calc(100dvh-var(--header-height)-var(--content-inset)*2))] flex-col">
      <AppHeaderLeading>
        <div data-ask-globee-thread-header="" className="flex min-w-0 items-center gap-[var(--space-2)]">
          <span className="flex size-4 shrink-0 items-center justify-center text-ink" aria-hidden>
            <ChevronLeft className="size-4" strokeWidth={1.33} />
          </span>
          <p className="truncate t-body-sm text-ink">{ASK_GLOBEE.threadTitle}</p>
          <ThreadIconButton label={ASK_GLOBEE.moreLabel}>
            <MoreHorizontal className="size-4" strokeWidth={1.33} />
          </ThreadIconButton>
        </div>
      </AppHeaderLeading>

      <div className="flex flex-1 flex-col gap-[var(--space-4)]">
        <div className="flex flex-1 flex-col gap-[var(--space-16)]">
          <div data-ask-globee-user-row="" className="flex items-start gap-[var(--space-2)]">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[length:var(--text-xs)] font-medium text-ink">
              {initials}
            </div>
            <div className="rounded-[var(--radius-lg)] bg-surface-muted p-[var(--space-4)]">
              <p className="t-body text-ink">{ASK_GLOBEE.userPrompt}</p>
            </div>
          </div>

          <div data-ask-globee-answer="" className="flex items-start gap-[var(--space-2)]">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[length:var(--text-xs)] font-medium text-accent-contrast">
              {ASK_GLOBEE.globeeMark}
            </div>
            <div className="flex w-full max-w-[640px] flex-col gap-[var(--space-2)]">
              <p className="t-body text-ink">{ASK_GLOBEE.answerLead}</p>
              <p className="t-body-sm text-ink-2">{ASK_GLOBEE.answerFollow}</p>
              <div className="flex flex-wrap items-center gap-[var(--space-4)]">
                <p className="t-body-sm text-ink-3">{ASK_GLOBEE.attribution}</p>
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
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="flex h-14 w-full max-w-[640px] items-center justify-between rounded-full border border-hairline bg-surface px-[var(--space-4)]">
            <span className="sr-only">{ASK_GLOBEE.composerPlaceholder}</span>
            <input
              type="text"
              name="prompt"
              placeholder={ASK_GLOBEE.composerPlaceholder}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent t-body-sm text-ink placeholder:text-ink-3 focus:outline-none"
            />
            <span className="flex size-4 shrink-0 items-center justify-center text-ink-3" aria-hidden>
              <ArrowRight className="size-4" strokeWidth={1.33} />
            </span>
          </label>
        </form>
      </div>
    </div>
  );
}
