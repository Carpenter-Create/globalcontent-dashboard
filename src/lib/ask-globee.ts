import { USER_MENU } from "@/lib/user-menu";

// Ask Globee copy and gating. Lives in lib/, not JSX.
// Access sees the upgrade gate only. Pro/Premium see the 7:73 landing, then
// 247:295 chrome on a persisted thread. Landing chips are suggested prompts —
// same catalog-grounded operator as unmapped free text. Landing persists the
// user turn and opens the thread; thinking chrome lives on the thread while
// the operator runs. In-flight sequence: empty lead + fetching relevant
// skills…, then finding the signal… (optional live catalog lead as the ink
// line). Time advances the verb — do not wait for a lead that never arrives.
// Never a hardcoded Winter Line fact, never a conversation_messages row.
// Tools may still use the findings lookup internally. Winter Line fixture
// strings stay here as a do-not-render lock. No checkout.

export type AskGlobeeTier = "access" | "pro" | "premium";

export type AskGlobeeThinkingPhase = "fetching" | "finding";

// Readable hold on fetching before finding chrome. House 8/16/24/48 scale.
export const ASK_GLOBEE_FETCHING_HOLD_MS = 1000;

export type MessagesSurface =
  | "staff-inbox"
  | "access-gate"
  | "ask-globee-landing"
  | "ask-globee-thread";

export const ASK_GLOBEE_TRY_PROMPTS = [
  "What needs attention",
  "What is blocking a title",
  "What should I submit next",
] as const;

export const ASK_GLOBEE = {
  pageTitle: "Messages",
  headline: "Ask Globee",
  need: "What do you need?",
  tryLabel: "Try one of these",
  tryPrompts: ASK_GLOBEE_TRY_PROMPTS,
  historyLabel: "History",
  historySearchPlaceholder: "Search past conversations",
  thisWeekLabel: "This week",
  allThreadsLabel: "All threads",
  pastConversationsLabel: "Past conversations",
  newConversationLabel: "New conversation",
  analyze: "Analyze anything about your catalog.",
  included: "Included with Pro and Premium.",
  upgrade: "Upgrade",
  upgradeHref: USER_MENU.agreementsHref,
  headerSearchPlaceholder: "Search",
  headerSearchHint: "⌘K",
  threadTitle: "What's blocking The Winter Line",
  userPrompt: "What's blocking The Winter Line?",
  answerLead: "The Winter Line is missing Genre. Genre is required before it can go live.",
  answerFollow: "Synopsis and Runtime are also required. Director is recommended.",
  attribution: "Globee AI · 7:10 AM",
  composerPlaceholder: "Ask a question or give a command.",
  globeeMark: "G",
  copyLabel: "Copy",
  downloadLabel: "Download",
  thumbsUpLabel: "Helpful",
  thumbsDownLabel: "Not helpful",
  moreLabel: "More",
  backLabel: "Back",
  sendLabel: "Send",
  attributionName: "Globee AI",
  renameLabel: "Rename",
  pinLabel: "Pin",
  unpinLabel: "Unpin",
  deleteLabel: "Delete",
  renameTitle: "Rename conversation",
  renameSave: "Save",
  deleteTitle: "Delete conversation",
  deleteBody: "This permanently deletes the conversation. It cannot be undone.",
  deleteConfirm: "Delete",
  cancelLabel: "Cancel",
  capability: "I can answer catalog attention, blockers, and what to submit next.",
  emptyBlocking: "Nothing required is blocking a title.",
  emptySubmitNext: "Nothing is ready to submit next.",
  thinking: "Thinking",
  fetchingSkills: "fetching relevant skills…",
  findingSignal: "finding the signal…",
  stop: "Stop",
  stopHint: "Esc",
  escToCancel: "Esc to cancel",
  unavailable: "Globee is unavailable right now. Try again, or ask what needs attention.",
} as const;

export const ASK_GLOBEE_QUERY = "q";
export const ASK_GLOBEE_THREAD_QUERY = "thread";
export const ASK_GLOBEE_TITLE_MAX = 80;

const THREAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAskGlobeeThreadId(value: string): boolean {
  return THREAD_ID_RE.test(value);
}

function readSearchValue(
  search: { get(name: string): string | null } | Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const raw =
    "get" in search && typeof search.get === "function"
      ? search.get(name)
      : (search as Record<string, string | string[] | undefined>)[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readAskGlobeePrompt(
  search: { get(name: string): string | null } | Record<string, string | string[] | undefined>,
): string | null {
  return readSearchValue(search, ASK_GLOBEE_QUERY);
}

export function readAskGlobeeThreadId(
  search: { get(name: string): string | null } | Record<string, string | string[] | undefined>,
): string | null {
  const value = readSearchValue(search, ASK_GLOBEE_THREAD_QUERY);
  return value && isAskGlobeeThreadId(value) ? value : null;
}

export function askGlobeeThreadHref(threadId: string): string | null {
  const next = threadId.trim();
  if (!isAskGlobeeThreadId(next)) return null;
  return `/messages?${ASK_GLOBEE_THREAD_QUERY}=${encodeURIComponent(next)}`;
}

export function askGlobeeLandingHref(): string {
  return "/messages";
}

export function askGlobeeComposerSubmit(prompt: string): string | null {
  const next = prompt.trim();
  return next.length > 0 ? next : null;
}

export function askGlobeeConversationTitle(prompt: string, max = ASK_GLOBEE_TITLE_MAX): string {
  const next = prompt.trim().replace(/\s+/g, " ");
  if (next.length <= max) return next;
  if (max <= 1) return next.slice(0, max);
  return `${next.slice(0, max - 1).trimEnd()}…`;
}

export function askGlobeeSelectedChip(prompt: string): (typeof ASK_GLOBEE_TRY_PROMPTS)[number] | null {
  const normalized = prompt.trim().toLowerCase();
  return ASK_GLOBEE_TRY_PROMPTS.find((label) => label.toLowerCase() === normalized) ?? null;
}

export function askGlobeeChipActivation(label: (typeof ASK_GLOBEE_TRY_PROMPTS)[number]): {
  prompt: string;
  selected: (typeof ASK_GLOBEE_TRY_PROMPTS)[number];
  send: string;
} {
  return { prompt: label, selected: label, send: label };
}

export function askGlobeeUsesModel(prompt: string): boolean {
  return askGlobeeComposerSubmit(prompt) !== null;
}

export function askGlobeeThinkingPhase(elapsedMs: number): AskGlobeeThinkingPhase {
  return elapsedMs < ASK_GLOBEE_FETCHING_HOLD_MS ? "fetching" : "finding";
}

export function askGlobeeThinkingVerb(phase: AskGlobeeThinkingPhase): string {
  return phase === "finding" ? ASK_GLOBEE.findingSignal : ASK_GLOBEE.fetchingSkills;
}

export function askGlobeeInFlightLead(
  phase: AskGlobeeThinkingPhase,
  lead: string | null | undefined,
): string | null {
  if (phase !== "finding") return null;
  const next = lead?.trim() ?? "";
  return next.length > 0 ? next : null;
}

export function messagesShowsThreadHeader(surface: MessagesSurface, threadId: string | null): boolean {
  if (surface === "access-gate" || surface === "staff-inbox") return false;
  if (surface === "ask-globee-thread") return true;
  return surface === "ask-globee-landing" && !!threadId;
}

export const ASK_GLOBEE_UNLOCKED_TIERS = ["pro", "premium"] as const;

export function isAskGlobeeTier(value: unknown): value is AskGlobeeTier {
  return value === "access" || value === "pro" || value === "premium";
}

export function isAskGlobeeUnlocked(tier: AskGlobeeTier | null): boolean {
  return tier === "pro" || tier === "premium";
}

export function resolveMessagesSurface(input: {
  isGcStaff: boolean;
  hasActiveOrg: boolean;
  tier: AskGlobeeTier | null;
}): MessagesSurface {
  if (!input.hasActiveOrg) {
    return input.isGcStaff ? "staff-inbox" : "access-gate";
  }
  return isAskGlobeeUnlocked(input.tier) ? "ask-globee-landing" : "access-gate";
}

export function canRenderAskGlobeeLanding(surface: MessagesSurface): boolean {
  return surface === "ask-globee-landing";
}

export function canRenderAskGlobeeThread(surface: MessagesSurface): boolean {
  return surface === "ask-globee-thread";
}

export function showMessagesHeaderSearch(surface: MessagesSurface): boolean {
  return surface === "access-gate";
}
