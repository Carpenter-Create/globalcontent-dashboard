import { ASK_GLOBEE, askGlobeeConversationTitle } from "@/lib/ask-globee";

export type AskGlobeeThumb = "up" | "down";

export type AskGlobeeHistoryRow = {
  id: string;
  title: string;
  pinned_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AskGlobeeStoredMessage = {
  id: string;
  role: "user" | "globee";
  body: string;
  lead: string | null;
  follow: string | null;
  thumbs: AskGlobeeThumb | null;
  created_at: string;
};

export function sortAskGlobeeHistory<T extends { pinned_at: string | null; updated_at: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (a.pinned_at && !b.pinned_at) return -1;
    if (!a.pinned_at && b.pinned_at) return 1;
    if (a.pinned_at && b.pinned_at && a.pinned_at !== b.pinned_at) {
      return a.pinned_at < b.pinned_at ? 1 : -1;
    }
    if (a.updated_at === b.updated_at) return 0;
    return a.updated_at < b.updated_at ? 1 : -1;
  });
}

export function askGlobeeAnswerText(lead: string, follow: string | null): string {
  const nextFollow = follow?.trim();
  return nextFollow ? `${lead}\n${nextFollow}` : lead;
}

export function askGlobeeDownloadFilename(title: string): string {
  const slug = askGlobeeConversationTitle(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "ask-globee"}.txt`;
}

export function nextAskGlobeeThumb(
  current: AskGlobeeThumb | null,
  clicked: AskGlobeeThumb,
): AskGlobeeThumb | null {
  return current === clicked ? null : clicked;
}

function startOfLocalDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function formatAskGlobeeClock(value: Date): string {
  const raw = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(value);
  return raw.replace(/\u202f/g, " ");
}

export function formatAskGlobeeHistoryTime(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const thenDay = startOfLocalDay(then);
  const nowDay = startOfLocalDay(now);
  const dayMs = 24 * 60 * 60 * 1000;
  if (thenDay === nowDay) return formatAskGlobeeClock(then);
  if (thenDay === nowDay - dayMs) return "Yesterday";
  if (thenDay > nowDay - 7 * dayMs && thenDay < nowDay) {
    return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(then);
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(then);
}

export function formatAskGlobeeAttribution(iso: string): string {
  return `${ASK_GLOBEE.attributionName} · ${formatAskGlobeeClock(new Date(iso))}`;
}
