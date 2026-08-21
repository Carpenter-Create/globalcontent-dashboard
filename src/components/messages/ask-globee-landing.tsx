"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

import {
  ASK_GLOBEE,
  askGlobeeChipActivation,
  askGlobeeComposerSubmit,
  askGlobeeSelectedChip,
  askGlobeeThreadHref,
  askGlobeeUsesModel,
} from "@/lib/ask-globee";
import {
  formatAskGlobeeHistoryTime,
  type AskGlobeeHistoryRow,
} from "@/lib/ask-globee-conversations";
import { cn } from "@/lib/cn";
import { startAskGlobeeConversation } from "@/app/(app)/messages/ask-globee-actions";
import { AskGlobeeThinking } from "./ask-globee-thinking";

// Figma 7:73 landing chrome. Chip click fills, selects, and sends. Submit
// sends. HISTORY lists real org threads only. No invented titles.
// Thinking chrome (246:296 Esc/stop) is only on the real model path.
export function AskGlobeeLanding({
  conversations = [],
}: {
  conversations?: AskGlobeeHistoryRow[];
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const selected = askGlobeeSelectedChip(prompt);

  function stopThinking() {
    cancelledRef.current = true;
    setThinking(false);
    setPending(false);
  }

  const send = async (value: string) => {
    if (pending) return;
    cancelledRef.current = false;
    setError(null);
    setPending(true);
    if (askGlobeeUsesModel(value)) setThinking(true);
    const result = await startAskGlobeeConversation(value);
    if (cancelledRef.current) return;
    setThinking(false);
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
      className="flex min-h-[min(36rem,calc(100dvh-var(--header-height)-var(--content-inset)*2))] flex-col items-center justify-center"
    >
      <div className="flex w-full flex-col items-center gap-[var(--space-8)]">
        <div className="flex flex-col items-center gap-[var(--space-2)]">
          <h1 data-ask-globee-headline="" className="t-display text-center text-ink">
            {ASK_GLOBEE.headline}
          </h1>
          <p data-ask-globee-need="" className="t-body text-center text-ink-2">
            {ASK_GLOBEE.need}
          </p>
        </div>

        <form
          data-ask-globee-composer=""
          className="flex w-full justify-center"
          onSubmit={(event) => {
            event.preventDefault();
            const next = askGlobeeComposerSubmit(prompt);
            if (next) void send(next);
          }}
        >
          <label className="flex h-14 w-full max-w-[640px] items-center justify-between rounded-full border border-hairline bg-surface px-[var(--space-4)]">
            <span className="sr-only">{ASK_GLOBEE.composerPlaceholder}</span>
            <input
              type="text"
              name="prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
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

        {thinking ? <AskGlobeeThinking onStop={stopThinking} /> : null}
        {error ? (
          <p data-ask-globee-error="" className="t-body-sm text-center text-ink-2">
            {error}
          </p>
        ) : null}

        <div
          data-ask-globee-try=""
          className="flex w-full max-w-[640px] flex-col items-center gap-[var(--space-3)]"
        >
          <p className="t-label text-ink-3">{ASK_GLOBEE.tryLabel}</p>
          <div className="flex flex-wrap justify-center gap-[var(--space-2)]">
            {ASK_GLOBEE.tryPrompts.map((label) => {
              const pressed = selected === label;
              return (
                <button
                  key={label}
                  type="button"
                  data-ask-globee-chip=""
                  aria-pressed={pressed}
                  onClick={() => {
                    const activation = askGlobeeChipActivation(label);
                    setPrompt(activation.prompt);
                    void send(activation.send);
                  }}
                  className={cn(
                    "inline-flex items-center rounded-full border bg-surface px-[var(--space-4)] py-[var(--space-2)] t-body-sm text-ink",
                    pressed ? "border-ink bg-surface-muted" : "border-hairline",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {conversations.length > 0 ? (
          <div
            data-ask-globee-history=""
            className="flex w-full max-w-[640px] flex-col gap-[var(--space-3)]"
          >
            <p className="t-label text-ink-3">{ASK_GLOBEE.historyLabel}</p>
            <ul className="flex flex-col">
              {conversations.map((row) => {
                const href = askGlobeeThreadHref(row.id);
                if (!href) return null;
                return (
                  <li key={row.id}>
                    <Link
                      href={href}
                      data-ask-globee-history-row=""
                      className="flex items-center justify-between gap-[var(--space-4)] py-[var(--space-3)]"
                    >
                      <span className="min-w-0 truncate t-body-sm text-ink">{row.title}</span>
                      <span className="shrink-0 t-body-sm text-ink-3">
                        {formatAskGlobeeHistoryTime(row.updated_at)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
