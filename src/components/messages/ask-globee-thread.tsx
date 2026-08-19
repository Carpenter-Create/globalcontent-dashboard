"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Copy,
  Download,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

import { ASK_GLOBEE, askGlobeeComposerSubmit } from "@/lib/ask-globee";
import {
  askGlobeeAnswerText,
  askGlobeeDownloadFilename,
  formatAskGlobeeAttribution,
  type AskGlobeeHistoryRow,
  type AskGlobeeStoredMessage,
  type AskGlobeeThumb,
} from "@/lib/ask-globee-conversations";
import {
  appendAskGlobeeTurn,
  setAskGlobeeThumb,
} from "@/app/(app)/messages/ask-globee-actions";
import { useAskGlobeeChrome } from "./ask-globee-chrome";

function ThreadIconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="flex size-6 items-center justify-center text-ink-3"
    >
      {children}
    </button>
  );
}

function downloadAnswer(title: string, lead: string, follow: string | null) {
  const blob = new Blob([askGlobeeAnswerText(lead, follow)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = askGlobeeDownloadFilename(title);
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AskGlobeeThread({
  initials,
  conversation,
  messages,
}: {
  initials: string;
  conversation: AskGlobeeHistoryRow;
  messages: AskGlobeeStoredMessage[];
}) {
  const router = useRouter();
  const { setChrome } = useAskGlobeeChrome();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, AskGlobeeThumb | null>>(() =>
    Object.fromEntries(messages.map((message) => [message.id, message.thumbs])),
  );

  useEffect(() => {
    setChrome({
      id: conversation.id,
      title: conversation.title,
      pinned_at: conversation.pinned_at,
    });
    return () => setChrome(null);
  }, [conversation.id, conversation.pinned_at, conversation.title, setChrome]);

  useEffect(() => {
    setThumbs(Object.fromEntries(messages.map((message) => [message.id, message.thumbs])));
  }, [messages]);

  return (
    <div data-ask-globee-thread="" className="flex min-h-[min(36rem,calc(100dvh-var(--header-height)-var(--content-inset)*2))] flex-col">
      <div className="flex flex-1 flex-col gap-[var(--space-4)]">
        <div
          data-ask-globee-conversation=""
          className="flex flex-1 flex-col gap-[var(--space-16)] px-[var(--content-inset)]"
        >
          {messages.map((message) =>
            message.role === "user" ? (
              <div
                key={message.id}
                data-ask-globee-user-row=""
                className="flex items-start gap-[var(--space-2)]"
              >
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[length:var(--text-xs)] font-medium text-ink">
                  {initials}
                </div>
                <div className="rounded-[var(--radius-lg)] bg-surface-muted p-[var(--space-4)]">
                  <p className="t-body text-ink">{message.body}</p>
                </div>
              </div>
            ) : (
              <div
                key={message.id}
                data-ask-globee-answer=""
                className="flex items-start gap-[var(--space-2)]"
              >
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[length:var(--text-xs)] font-medium text-accent-contrast">
                  {ASK_GLOBEE.globeeMark}
                </div>
                <div className="flex w-full max-w-[640px] flex-col gap-[var(--space-2)]">
                  <p className="t-body text-ink">{message.lead ?? message.body}</p>
                  {message.follow ? <p className="t-body-sm text-ink-2">{message.follow}</p> : null}
                  <div className="flex flex-wrap items-center gap-[var(--space-4)]">
                    <p className="t-body-sm text-ink-3">
                      {formatAskGlobeeAttribution(message.created_at)}
                    </p>
                    <div className="flex items-center gap-[var(--space-4)]">
                      <ThreadIconButton
                        label={ASK_GLOBEE.copyLabel}
                        onClick={() => {
                          void navigator.clipboard.writeText(
                            askGlobeeAnswerText(message.lead ?? message.body, message.follow),
                          );
                        }}
                      >
                        <Copy className="size-4" strokeWidth={1.33} />
                      </ThreadIconButton>
                      <ThreadIconButton
                        label={ASK_GLOBEE.downloadLabel}
                        onClick={() =>
                          downloadAnswer(
                            conversation.title,
                            message.lead ?? message.body,
                            message.follow,
                          )
                        }
                      >
                        <Download className="size-4" strokeWidth={1.33} />
                      </ThreadIconButton>
                      <ThreadIconButton
                        label={ASK_GLOBEE.thumbsUpLabel}
                        pressed={thumbs[message.id] === "up"}
                        onClick={() => {
                          void setAskGlobeeThumb(message.id, "up").then((result) => {
                            if ("thumbs" in result) {
                              setThumbs((current) => ({ ...current, [message.id]: result.thumbs }));
                            }
                          });
                        }}
                      >
                        <ThumbsUp
                          className="size-4"
                          strokeWidth={1.33}
                          fill={thumbs[message.id] === "up" ? "currentColor" : "none"}
                        />
                      </ThreadIconButton>
                      <ThreadIconButton
                        label={ASK_GLOBEE.thumbsDownLabel}
                        pressed={thumbs[message.id] === "down"}
                        onClick={() => {
                          void setAskGlobeeThumb(message.id, "down").then((result) => {
                            if ("thumbs" in result) {
                              setThumbs((current) => ({ ...current, [message.id]: result.thumbs }));
                            }
                          });
                        }}
                      >
                        <ThumbsDown
                          className="size-4"
                          strokeWidth={1.33}
                          fill={thumbs[message.id] === "down" ? "currentColor" : "none"}
                        />
                      </ThreadIconButton>
                    </div>
                  </div>
                </div>
              </div>
            ),
          )}
        </div>

        <form
          data-ask-globee-composer=""
          className="flex justify-center"
          onSubmit={(event) => {
            event.preventDefault();
            const next = askGlobeeComposerSubmit(draft);
            if (!next || pending) return;
            setPending(true);
            void appendAskGlobeeTurn(conversation.id, next).then((result) => {
              setPending(false);
              if (!("error" in result)) {
                setDraft("");
                router.refresh();
              }
            });
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
