"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
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

const COPIED_MS = 1500;
const COMPOSER_FOCUS =
  "outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 outline-none! ring-0! focus-visible:outline-none! focus-visible:ring-0!";

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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [thumbOverrides, setThumbOverrides] = useState<Record<string, AskGlobeeThumb | null>>({});
  const latestTurnRef = useRef<HTMLDivElement>(null);
  const copiedTimerRef = useRef<number>(0);
  const followRef = useRef<{ conversationId: string; length: number } | null>(null);

  useEffect(() => {
    setChrome({
      id: conversation.id,
      title: conversation.title,
      pinned_at: conversation.pinned_at,
    });
    return () => setChrome(null);
  }, [conversation.id, conversation.pinned_at, conversation.title, setChrome]);

  useEffect(() => {
    return () => window.clearTimeout(copiedTimerRef.current);
  }, []);

  useEffect(() => {
    const previous = followRef.current;
    const grew =
      previous !== null &&
      previous.conversationId === conversation.id &&
      messages.length > previous.length;
    followRef.current = { conversationId: conversation.id, length: messages.length };
    if (!grew) return;
    latestTurnRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
  }, [conversation.id, messages]);

  function thumbsFor(message: AskGlobeeStoredMessage): AskGlobeeThumb | null {
    return Object.hasOwn(thumbOverrides, message.id) ? thumbOverrides[message.id] ?? null : message.thumbs;
  }

  function copyAnswer(message: AskGlobeeStoredMessage) {
    void navigator.clipboard.writeText(
      askGlobeeAnswerText(message.lead ?? message.body, message.follow),
    ).then(() => {
        window.clearTimeout(copiedTimerRef.current);
        setCopiedId(message.id);
        copiedTimerRef.current = window.setTimeout(() => {
          setCopiedId((current) => (current === message.id ? null : current));
        }, COPIED_MS);
      });
  }

  const turns: AskGlobeeStoredMessage[][] = [];
  for (const message of messages) {
    if (message.role === "user" || turns.length === 0) {
      turns.push([message]);
    } else {
      turns[turns.length - 1]?.push(message);
    }
  }

  return (
    <div data-ask-globee-thread="" className="flex min-h-[min(36rem,calc(100dvh-var(--header-height)-var(--content-inset)*2))] flex-col">
      <div className="flex flex-1 flex-col gap-[var(--space-4)]">
        <div
          data-ask-globee-conversation=""
          className="flex flex-1 flex-col gap-[var(--space-6)] px-[var(--content-inset)]"
        >
          {turns.map((turn, index) => (
            <div
              key={turn[0]?.id ?? String(index)}
              ref={index === turns.length - 1 ? latestTurnRef : undefined}
              data-ask-globee-turn=""
              data-ask-globee-thread-end={index === turns.length - 1 ? "" : undefined}
              className={
                index > 0
                  ? "flex flex-col gap-[var(--space-6)] scroll-mt-[var(--header-height)] border-t border-hairline"
                  : "flex flex-col gap-[var(--space-6)] scroll-mt-[var(--header-height)]"
              }
            >
              {turn.map((message) =>
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
                            pressed={copiedId === message.id}
                            onClick={() => copyAnswer(message)}
                          >
                            {copiedId === message.id ? (
                              <Check className="size-4" strokeWidth={1.33} data-ask-globee-copied="" />
                            ) : (
                              <Copy className="size-4" strokeWidth={1.33} />
                            )}
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
                            pressed={thumbsFor(message) === "up"}
                            onClick={() => {
                              void setAskGlobeeThumb(message.id, "up").then((result) => {
                                if ("thumbs" in result) {
                                  setThumbOverrides((current) => ({ ...current, [message.id]: result.thumbs }));
                                }
                              });
                            }}
                          >
                            <ThumbsUp
                              className="size-4"
                              strokeWidth={1.33}
                              fill={thumbsFor(message) === "up" ? "currentColor" : "none"}
                            />
                          </ThreadIconButton>
                          <ThreadIconButton
                            label={ASK_GLOBEE.thumbsDownLabel}
                            pressed={thumbsFor(message) === "down"}
                            onClick={() => {
                              void setAskGlobeeThumb(message.id, "down").then((result) => {
                                if ("thumbs" in result) {
                                  setThumbOverrides((current) => ({ ...current, [message.id]: result.thumbs }));
                                }
                              });
                            }}
                          >
                            <ThumbsDown
                              className="size-4"
                              strokeWidth={1.33}
                              fill={thumbsFor(message) === "down" ? "currentColor" : "none"}
                            />
                          </ThreadIconButton>
                        </div>
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          ))}
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
          <label
            className={`flex h-14 w-full max-w-[640px] items-center justify-between rounded-full border border-hairline bg-surface px-[var(--space-4)] ${COMPOSER_FOCUS}`}
          >
            <span className="sr-only">{ASK_GLOBEE.composerPlaceholder}</span>
            <input
              type="text"
              name="prompt"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={ASK_GLOBEE.composerPlaceholder}
              autoComplete="off"
              className={`min-w-0 flex-1 bg-transparent t-body-sm text-ink placeholder:text-ink-3 ${COMPOSER_FOCUS}`}
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
