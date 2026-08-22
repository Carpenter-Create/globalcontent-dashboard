import { ASK_GLOBEE } from "@/lib/ask-globee";

export { askGlobeeDownloadFilename } from "@/lib/ask-globee-download";

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

export function askGlobeeOpenUserTurn(
  messages: ReadonlyArray<{ role: "user" | "globee"; body: string }>,
): string | null {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return null;
  const next = last.body.trim();
  return next.length > 0 ? next : null;
}

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

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export function isAskGlobeeHistoryThisWeek(iso: string, now = new Date()): boolean {
  return startOfLocalDay(new Date(iso)) > startOfLocalDay(now) - WEEK_MS;
}

export function filterAskGlobeeHistory<T extends { title: string }>(rows: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => row.title.toLowerCase().includes(needle));
}

export function groupAskGlobeeHistory<T extends { updated_at: string }>(
  rows: T[],
  now = new Date(),
): { thisWeek: T[]; allThreads: T[] } {
  const thisWeek: T[] = [];
  const allThreads: T[] = [];
  for (const row of rows) {
    if (isAskGlobeeHistoryThisWeek(row.updated_at, now)) thisWeek.push(row);
    else allThreads.push(row);
  }
  return { thisWeek, allThreads };
}

export function formatAskGlobeeHistoryTime(iso: string, now = new Date()): string {
  const then = new Date(iso);
  const thenDay = startOfLocalDay(then);
  const nowDay = startOfLocalDay(now);
  if (thenDay === nowDay) return formatAskGlobeeClock(then);
  if (thenDay === nowDay - DAY_MS) return "Yesterday";
  if (thenDay > nowDay - WEEK_MS && thenDay < nowDay) {
    return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(then);
  }
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(then);
}

// Help-desk leftover. Do not render on the 247:295 thread answer (247:378).
export function formatAskGlobeeAttribution(iso: string): string {
  return `${ASK_GLOBEE.attributionName} · ${formatAskGlobeeClock(new Date(iso))}`;
}
