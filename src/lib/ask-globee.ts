import { USER_MENU } from "@/lib/user-menu";

// Ask Globee copy and gating. Lives in lib/, not JSX.
// Access sees the upgrade gate only. Pro/Premium see the 7:73 landing, then
// 247:295 chrome after send. Winter Line fixture strings stay here as a
// do-not-render lock — live answers come from org-filtered findings only.
// No AI backend, no persist, no invented commercial text, no checkout.

export type AskGlobeeTier = "access" | "pro" | "premium";

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
  capability: "I can answer catalog attention, blockers, and what to submit next.",
  emptyBlocking: "Nothing required is blocking a title.",
  emptySubmitNext: "Nothing is ready to submit next.",
} as const;

export const ASK_GLOBEE_QUERY = "q";

export function readAskGlobeePrompt(
  search: { get(name: string): string | null } | Record<string, string | string[] | undefined>,
): string | null {
  const raw =
    "get" in search && typeof search.get === "function"
      ? search.get(ASK_GLOBEE_QUERY)
      : (search as Record<string, string | string[] | undefined>)[ASK_GLOBEE_QUERY];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function askGlobeeThreadHref(prompt: string): string | null {
  const next = prompt.trim();
  if (!next) return null;
  return `/messages?${ASK_GLOBEE_QUERY}=${encodeURIComponent(next)}`;
}

export function askGlobeeLandingHref(): string {
  return "/messages";
}

export function askGlobeeComposerSubmit(prompt: string): string | null {
  const next = prompt.trim();
  return next.length > 0 ? next : null;
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

export function messagesShowsThreadHeader(surface: MessagesSurface, prompt: string | null): boolean {
  if (surface === "access-gate" || surface === "staff-inbox") return false;
  if (surface === "ask-globee-thread") return true;
  return surface === "ask-globee-landing" && !!prompt;
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
