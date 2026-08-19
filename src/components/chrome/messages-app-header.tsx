"use client";

import { Suspense } from "react";
import { ChevronLeft, MoreHorizontal } from "lucide-react";

import { SearchField } from "@/components/layout/search-field";
import { ASK_GLOBEE, type MessagesSurface } from "@/lib/ask-globee";

export function MessagesAppHeader({ surface }: { surface: MessagesSurface }) {
  if (surface === "access-gate") {
    return (
      <div data-header-search="" className="flex min-w-0 items-center">
        <Suspense fallback={null}>
          <SearchField
            placeholder={ASK_GLOBEE.headerSearchPlaceholder}
            hint={ASK_GLOBEE.headerSearchHint}
          />
        </Suspense>
      </div>
    );
  }

  if (surface === "ask-globee-landing") {
    return null;
  }

  if (surface === "ask-globee-thread") {
    return (
      <div data-header-thread="" className="flex min-w-0 items-center gap-[var(--space-2)]">
        <span className="flex size-4 shrink-0 items-center justify-center text-ink" aria-hidden>
          <ChevronLeft className="size-4" strokeWidth={1.33} />
        </span>
        <p className="truncate t-body-sm text-ink">{ASK_GLOBEE.threadTitle}</p>
        <button
          type="button"
          aria-label={ASK_GLOBEE.moreLabel}
          className="flex size-6 shrink-0 items-center justify-center text-ink-3"
        >
          <MoreHorizontal className="size-4" strokeWidth={1.33} />
        </button>
      </div>
    );
  }

  return null;
}
