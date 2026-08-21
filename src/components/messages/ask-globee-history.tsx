"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

import { ASK_GLOBEE, askGlobeeThreadHref } from "@/lib/ask-globee";
import {
  filterAskGlobeeHistory,
  formatAskGlobeeHistoryTime,
  groupAskGlobeeHistory,
  type AskGlobeeHistoryRow,
} from "@/lib/ask-globee-conversations";
import { cn } from "@/lib/cn";

// Hairline history popover. Real org conversations only. Empty is empty.

export function AskGlobeeHistoryPanel({
  conversations,
  currentId = null,
  now,
}: {
  conversations: AskGlobeeHistoryRow[];
  currentId?: string | null;
  now?: Date;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const filtered = filterAskGlobeeHistory(conversations, query);
  const { thisWeek, allThreads } = groupAskGlobeeHistory(filtered, now);

  return (
    <div
      data-ask-globee-history-popover=""
      className="flex w-[384px] flex-col gap-[var(--space-6)] rounded-[12px] border border-hairline bg-surface p-[var(--space-6)] shadow-none"
    >
      <label className="block">
        <span className="sr-only">{ASK_GLOBEE.historySearchPlaceholder}</span>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={ASK_GLOBEE.historySearchPlaceholder}
          autoComplete="off"
          data-ask-globee-history-search=""
          className="h-10 w-full rounded-[var(--radius-sm)] border border-hairline bg-transparent px-[var(--space-3)] t-body-sm text-ink placeholder:text-ink-3 focus:outline-none"
        />
      </label>

      {thisWeek.length > 0 ? (
        <HistoryGroup label={ASK_GLOBEE.thisWeekLabel} rows={thisWeek} currentId={currentId} now={now} />
      ) : null}
      {allThreads.length > 0 ? (
        <HistoryGroup label={ASK_GLOBEE.allThreadsLabel} rows={allThreads} currentId={currentId} now={now} />
      ) : null}
    </div>
  );
}

function HistoryGroup({
  label,
  rows,
  currentId,
  now,
}: {
  label: string;
  rows: AskGlobeeHistoryRow[];
  currentId: string | null;
  now?: Date;
}) {
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <p className="t-label text-ink-3">{label}</p>
      <ul className="flex flex-col gap-[var(--space-2)]">
        {rows.map((row) => {
          const href = askGlobeeThreadHref(row.id);
          if (!href) return null;
          const current = row.id === currentId;
          return (
            <li key={row.id}>
              <Link
                href={href}
                data-ask-globee-history-row=""
                data-ask-globee-history-current={current ? "" : undefined}
                className={cn(
                  "flex items-center justify-between gap-[var(--space-4)] px-[var(--space-3)] py-[var(--space-2)]",
                  current ? "border border-hairline bg-transparent" : null,
                )}
              >
                <span className="min-w-0 truncate t-body text-ink">{row.title}</span>
                <span className="shrink-0 t-body-sm text-ink-3">
                  {formatAskGlobeeHistoryTime(row.updated_at, now)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function AskGlobeeHistoryPopover({
  conversations,
  currentId = null,
  open,
  onOpenChange,
  children,
}: {
  conversations: AskGlobeeHistoryRow[];
  currentId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node) || root.contains(event.target)) return;
      onOpenChange(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative">
      {children}
      {open ? (
        <div className="absolute left-0 top-full z-50 mt-[var(--space-2)]">
          <AskGlobeeHistoryPanel conversations={conversations} currentId={currentId} />
        </div>
      ) : null}
    </div>
  );
}
