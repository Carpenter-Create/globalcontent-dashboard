"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, MoreHorizontal } from "lucide-react";

import { SearchField } from "@/components/layout/search-field";
import {
  ASK_GLOBEE,
  askGlobeeLandingHref,
  messagesShowsThreadHeader,
  readAskGlobeePrompt,
  showMessagesHeaderSearch,
  type MessagesSurface,
} from "@/lib/ask-globee";

function MessagesThreadHeader({ title }: { title: string }) {
  return (
    <div data-header-thread="" className="flex min-w-0 items-center gap-[var(--space-2)]">
      <Link
        href={askGlobeeLandingHref()}
        aria-label={ASK_GLOBEE.backLabel}
        className="flex size-4 shrink-0 items-center justify-center text-ink"
      >
        <ChevronLeft className="size-4" strokeWidth={1.33} />
      </Link>
      <p className="truncate t-body-sm text-ink">{title}</p>
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

function MessagesAppHeaderInner({ surface }: { surface: MessagesSurface }) {
  const prompt = readAskGlobeePrompt(useSearchParams());

  // Search mounts only for access-gate. Ask Globee landing/thread never restore it.
  if (surface === "access-gate" || showMessagesHeaderSearch(surface)) {
    return (
      <div data-header-search="" className="flex min-w-0 items-center">
        <SearchField
          placeholder={ASK_GLOBEE.headerSearchPlaceholder}
          hint={ASK_GLOBEE.headerSearchHint}
        />
      </div>
    );
  }

  if (messagesShowsThreadHeader(surface, prompt)) {
    return <MessagesThreadHeader title={prompt ?? ""} />;
  }

  return null;
}

export function MessagesAppHeader({ surface }: { surface: MessagesSurface }) {
  return (
    <Suspense fallback={null}>
      <MessagesAppHeaderInner surface={surface} />
    </Suspense>
  );
}
