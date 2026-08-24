"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Download,
  MoreHorizontal,
  Pencil,
  Pin,
  Trash2,
} from "lucide-react";

import { SearchField } from "@/components/layout/search-field";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ThreadPopoverContent,
  ThreadPopoverItem,
  ThreadPopoverSeparator,
} from "./menu-surface";
import { cn } from "@/lib/cn";
import {
  THREAD_POPOVER_DELETE_ICON_CLASS,
  THREAD_POPOVER_ICON_CLASS,
} from "@/lib/house-sheet";
import {
  MENU_SURFACE_ITEM_CLASS,
  MENU_SURFACE_ITEM_DANGER_CLASS,
} from "@/lib/menu-surface";
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

// Desktop 247:295 keeps PDF + ··· in the right cluster, 16 from the avatar.
// Mobile 531:542 hides the PDF tray; Download PDF lives in the existing ···
// (532:548). No second menu.
function MessagesThreadHeader({ title }: { title: string }) {
  const router = useRouter();
  const { chrome, setChrome, conversations } = useAskGlobeeChrome();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(title);
  const pinned = !!chrome?.pinned_at;
  const threadTitle = chrome?.title ?? title;

  function downloadThread() {
    if (!chrome) return;
    saveAskGlobeeDownload({
      title: chrome.title,
      initials: chrome.initials ?? "",
      messages: chrome.messages ?? [],
    });
  }

  // Title+chevron stay left. Download/··· dock 16 from the avatar via
  // app-shell header gap-4 — same relationship as mobile #182. flex-1 on
  // this row and the title cluster; without it the row shrinks to the
  // words and actions read as title chrome. Do not put actions flush to
  // the title. Desktop PDF tray stays in this right cluster, before ···.
  return (
    <div data-header-thread="" className="flex min-w-0 flex-1 items-center gap-[var(--space-4)]">
      <div
        data-ask-globee-title-cluster=""
        className="flex min-w-0 flex-1 items-center gap-[var(--space-2)]"
      >
        <Link
          href={askGlobeeLandingHref()}
          aria-label={ASK_GLOBEE.backLabel}
          className="flex size-4 shrink-0 items-center justify-center text-ink max-md:text-ink-3"
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
            <span className="min-w-0 truncate t-heading text-ink max-md:hidden">{threadTitle}</span>
            <span className="min-w-0 truncate t-body text-ink md:hidden">{threadTitle}</span>
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
          onClick={downloadThread}
          className="hidden size-4 shrink-0 items-center justify-center text-ink-3 md:flex"
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
          <ThreadPopoverContent align="end">
            <ThreadPopoverItem onSelect={downloadThread}>
              <Download className={THREAD_POPOVER_ICON_CLASS} strokeWidth={1.33} />
              {ASK_GLOBEE.downloadPdfLabel}
            </ThreadPopoverItem>
            <ThreadPopoverItem
              onSelect={() => {
                setRenameValue(chrome?.title ?? title);
                setRenameOpen(true);
              }}
            >
              <Pencil className={THREAD_POPOVER_ICON_CLASS} strokeWidth={1.33} />
              {ASK_GLOBEE.renameLabel}
            </ThreadPopoverItem>
            <ThreadPopoverItem
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
              <Pin className={THREAD_POPOVER_ICON_CLASS} strokeWidth={1.33} />
              {pinned ? ASK_GLOBEE.unpinLabel : ASK_GLOBEE.pinLabel}
            </ThreadPopoverItem>
            <ThreadPopoverSeparator />
            <ThreadPopoverItem danger onSelect={() => setDeleteOpen(true)}>
              <Trash2 className={THREAD_POPOVER_DELETE_ICON_CLASS} strokeWidth={1.33} />
              {ASK_GLOBEE.deleteLabel}
            </ThreadPopoverItem>
          </ThreadPopoverContent>
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
          <button
            type="button"
            data-ask-globee-delete-cancel=""
            className={MENU_SURFACE_ITEM_CLASS}
            onClick={() => setDeleteOpen(false)}
          >
            {ASK_GLOBEE.cancelLabel}
          </button>
          <button
            type="button"
            data-ask-globee-delete-confirm=""
            className={cn(MENU_SURFACE_ITEM_CLASS, MENU_SURFACE_ITEM_DANGER_CLASS)}
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
          </button>
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
