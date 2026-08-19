"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

import {
  ASK_GLOBEE,
  askGlobeeChipActivation,
  askGlobeeComposerSubmit,
  askGlobeeSelectedChip,
  askGlobeeThreadHref,
} from "@/lib/ask-globee";
import { cn } from "@/lib/cn";

// Figma 7:73 landing chrome. Chip click fills, selects, and sends. Submit
// sends. History stays omitted until real rows exist. No invented answer.
export function AskGlobeeLanding() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const selected = askGlobeeSelectedChip(prompt);

  const send = (value: string) => {
    const href = askGlobeeThreadHref(value);
    if (href) router.replace(href);
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
            if (next) send(next);
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
                    send(activation.send);
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
      </div>
    </div>
  );
}
