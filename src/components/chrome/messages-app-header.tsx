"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronUp, Download, MoreHorizontal } from "lucide-react";

import { SearchField } from "@/components/layout/search-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ASK_GLOBEE,
  askGlobeeLandingHref,
  messagesShowsThreadHeader,
  readAskGlobeeThreadId,
  showMessagesHeaderSearch,
  type MessagesSurface,
} from "@/lib/ask-globee";
import { AskGlobeeHistoryPopover } from "@/components/messages/ask-globee-history";
import { useAskGlobeeChrome } from "@/components/messages/ask-globee-chrome";
import { saveAskGlobeeDownload } from "@/lib/ask-globee-download";
import {
  deleteAskGlobeeConversation,
  pinAskGlobeeConversation,
  renameAskGlobeeConversation,
} from "@/app/(app)/messages/ask-globee-actions";

function MessagesThreadHeader({ title }: { title: string }) {
  const router = useRouter();
  const { chrome, setChrome, conversations } = useAskGlobeeChrome();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const pinned = !!chrome?.pinned_at;
  const threadTitle = chrome?.title ?? title;

  return (
    <div data-header-thread="" className="flex min-w-0 items-center gap-[var(--space-4)]">
      <div className="flex min-w-0 flex-1 items-center gap-[var(--space-2)]">
        <Link
          href={askGlobeeLandingHref()}
          aria-label={ASK_GLOBEE.backLabel}
          className="flex size-4 shrink-0 items-center justify-center text-ink"
        >
          <ChevronLeft className="size-4" strokeWidth={1.33} />
        </Link>
        <AskGlobeeHistoryPopover
          conversations={conversations}
          currentId={chrome?.id ?? null}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
        >
          <button
            type="button"
            data-ask-globee-history-title=""
            aria-expanded={historyOpen}
            aria-haspopup="dialog"
            onClick={() => setHistoryOpen((open) => !open)}
            className="flex min-w-0 items-center gap-[var(--space-1)] text-left"
          >
            <span className="truncate t-heading text-ink">{threadTitle}</span>
            {historyOpen ? (
              <ChevronUp className="size-4 shrink-0 text-ink-3" strokeWidth={1.33} />
            ) : (
              <ChevronDown className="size-4 shrink-0 text-ink-3" strokeWidth={1.33} />
            )}
          </button>
        </AskGlobeeHistoryPopover>
      </div>
      <div
        data-ask-globee-header-chrome=""
        className="flex shrink-0 items-center gap-[var(--space-4)]"
      >
        <button
          type="button"
          data-ask-globee-download=""
          aria-label={ASK_GLOBEE.downloadLabel}
          onClick={() => {
            if (!chrome) return;
            saveAskGlobeeDownload({
              title: chrome.title,
              initials: chrome.initials ?? "",
              messages: chrome.messages ?? [],
            });
          }}
          className="flex size-4 shrink-0 items-center justify-center text-ink-3"
        >
          <Download className="size-4" strokeWidth={1.33} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={ASK_GLOBEE.moreLabel}
              className="flex size-4 shrink-0 items-center justify-center text-ink-3"
            >
              <MoreHorizontal className="size-4" strokeWidth={1.33} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onSelect={() => {
                setRenameValue(chrome?.title ?? title);
                setRenameOpen(true);
              }}
            >
              {ASK_GLOBEE.renameLabel}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!chrome) return;
                void pinAskGlobeeConversation(chrome.id, !pinned).then((result) => {
                  if ("pinnedAt" in result) {
                    setChrome({ ...chrome, pinned_at: result.pinnedAt });
                    router.refresh();
                  }
                });
              }}
            >
              {pinned ? ASK_GLOBEE.unpinLabel : ASK_GLOBEE.pinLabel}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDeleteOpen(true)}>
              {ASK_GLOBEE.deleteLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title={ASK_GLOBEE.renameTitle}
      >
        <form
          className="flex flex-col gap-[var(--space-3)]"
          onSubmit={(event) => {
            event.preventDefault();
            if (!chrome) return;
            void renameAskGlobeeConversation(chrome.id, renameValue).then((result) => {
              if ("title" in result) {
                setChrome({ ...chrome, title: result.title });
                setRenameOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            aria-label={ASK_GLOBEE.renameTitle}
          />
          <div className="flex justify-end gap-[var(--space-2)]">
            <Button type="button" variant="secondary" onClick={() => setRenameOpen(false)}>
              {ASK_GLOBEE.cancelLabel}
            </Button>
            <Button type="submit">{ASK_GLOBEE.renameSave}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={ASK_GLOBEE.deleteTitle}
      >
        <p className="t-body-sm text-ink-2">{ASK_GLOBEE.deleteBody}</p>
        <div className="mt-[var(--space-4)] flex justify-end gap-[var(--space-2)]">
          <Button type="button" variant="secondary" onClick={() => setDeleteOpen(false)}>
            {ASK_GLOBEE.cancelLabel}
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (!chrome) return;
              void deleteAskGlobeeConversation(chrome.id).then((result) => {
                if (!("error" in result)) {
                  setDeleteOpen(false);
                  setChrome(null);
                  router.push(askGlobeeLandingHref());
                }
              });
            }}
          >
            {ASK_GLOBEE.deleteConfirm}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function MessagesAppHeaderInner({ surface }: { surface: MessagesSurface }) {
  const threadId = readAskGlobeeThreadId(useSearchParams());

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

  if (messagesShowsThreadHeader(surface, threadId)) {
    return <MessagesThreadHeader title="" />;
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
