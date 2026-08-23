"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, Clock, Send, Slash, type LucideIcon } from "lucide-react";

import {
  ASK_GLOBEE,
  askGlobeeChipActivation,
  askGlobeeChipMark,
  askGlobeeComposerSubmit,
  askGlobeeSelectedChip,
  askGlobeeThreadHref,
  type AskGlobeeChipMark,
} from "@/lib/ask-globee";
import { type AskGlobeeHistoryRow } from "@/lib/ask-globee-conversations";
import { startAskGlobeeConversation } from "@/app/(app)/messages/ask-globee-actions";
import { AskGlobeeHistoryPopover } from "./ask-globee-history";

const CHIP_MARK_ICON: Record<AskGlobeeChipMark, LucideIcon> = {
  alert: CircleAlert,
  slash: Slash,
  send: Send,
};

// Figma 7:73 landing chrome (Design 2026-08-22 proto), shared with mobile 462:502
// tokens: no-period placeholder, Sporty Blue 24 submit, wash chips, 48 between
// headline / composer / chips on desktop. Chip click fills, selects, and sends
// the same prompt as free text. Submit persists the user turn, then navigates
// to the thread. Quiet clock 16 (top-left, tertiary) opens past conversations.
// No plus on this empty home. No HISTORY list. No invented titles. Well pad
// and ask stack use house 48 (--space-12). Composer is 640×56 r28 pad 16 —
// not a full pill. Thinking chrome (427:352 empty lead + fetching…) is on
// the conversation page, never this landing.
// Mobile 462:502 only (max-md): centered stack, chips above the composer,
// full-width chip column. Desktop 7:73 is headline, then composer, then chips
// (md:order). Drop "What do you need?". No Beta. No Mercury. No Circle brand fill.
export function AskGlobeeLanding({
  conversations = [],
}: {
  conversations?: AskGlobeeHistoryRow[];
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const selected = askGlobeeSelectedChip(prompt);

  const send = async (value: string) => {
    if (pending) return;
    setError(null);
    setPending(true);
    const result = await startAskGlobeeConversation(value);
    if (result.conversationId) {
      const href = askGlobeeThreadHref(result.conversationId);
      if (href) {
        router.push(href);
        return;
      }
    }
    setPending(false);
    if (result.error) setError(result.error);
  };

  return (
    <div
      data-ask-globee-landing=""
      className="relative flex min-h-[min(36rem,calc(100dvh-var(--header-height)-var(--content-inset)*2))] flex-col items-center p-[var(--space-12)] max-md:px-[var(--space-4)]"
    >
      <div className="absolute left-0 top-0">
        <AskGlobeeHistoryPopover
          conversations={conversations}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
        >
          <button
            type="button"
            data-ask-globee-clock=""
            aria-label={ASK_GLOBEE.pastConversationsLabel}
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
            className="flex size-4 items-center justify-center text-ink-3"
          >
            <Clock className="size-4" strokeWidth={1.33} />
          </button>
        </AskGlobeeHistoryPopover>
      </div>

      <div className="flex w-full flex-1 flex-col items-center justify-center gap-[var(--space-12)]">
        <h1 data-ask-globee-headline="" className="t-display text-center text-ink">
          {ASK_GLOBEE.headline}
        </h1>

        <div className="flex w-full flex-col items-center max-md:gap-[var(--space-12)] md:contents">
          <div
            data-ask-globee-try=""
            className="flex w-full max-w-[640px] flex-col items-center gap-[var(--space-4)] md:order-3"
          >
            <p className="t-label text-ink-3">{ASK_GLOBEE.tryLabel}</p>
            <div className="flex flex-wrap justify-center gap-[var(--space-2)] max-md:w-full max-md:flex-col max-md:items-stretch">
              {ASK_GLOBEE.tryPrompts.map((label, index) => {
                const pressed = selected === label;
                const mark = askGlobeeChipMark(index);
                const MarkIcon = mark ? CHIP_MARK_ICON[mark] : null;
                return (
                  <button
                    key={label}
                    type="button"
                    data-ask-globee-chip=""
                    data-ask-globee-chip-mark={mark ?? undefined}
                    aria-pressed={pressed}
                    onClick={() => {
                      const activation = askGlobeeChipActivation(label);
                      setPrompt(activation.prompt);
                      void send(activation.send);
                    }}
                    className="inline-flex items-center gap-[var(--space-2)] rounded-full border-0 bg-surface-muted px-[var(--space-4)] py-[var(--space-2)] t-body-sm text-ink"
                  >
                    {MarkIcon ? (
                      <MarkIcon
                        aria-hidden="true"
                        className="size-4 text-ink-3"
                        strokeWidth={1.33}
                      />
                    ) : null}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <form
            data-ask-globee-composer=""
            className="flex w-full justify-center md:order-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = askGlobeeComposerSubmit(prompt);
              if (next) void send(next);
            }}
          >
            <label className="flex h-14 w-full max-w-[640px] items-center justify-between rounded-[28px] border border-hairline bg-surface px-[var(--space-4)]">
              <span className="sr-only">{ASK_GLOBEE.composerPlaceholderMobile}</span>
              <input
                type="text"
                name="prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={ASK_GLOBEE.composerPlaceholderMobile}
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-left t-body-sm text-ink placeholder:text-ink-3 focus:outline-none"
              />
              <button
                type="submit"
                aria-label={ASK_GLOBEE.sendLabel}
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast"
              >
                <ArrowRight className="size-4" strokeWidth={1.33} />
              </button>
            </label>
          </form>

          {error ? (
            <p
              data-ask-globee-error=""
              className="t-body-sm text-center text-ink-2 md:order-2"
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
