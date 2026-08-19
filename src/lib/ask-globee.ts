import { USER_MENU } from "@/lib/user-menu";

// Ask Globee copy and gating. Lives in lib/, not JSX.
// Access sees the upgrade gate only. Pro/Premium may see the locked 247:295 fixture.
// No AI backend, no invented commercial text, no checkout.

export type AskGlobeeTier = "access" | "pro" | "premium";

export type MessagesSurface = "staff-inbox" | "access-gate" | "ask-globee-thread";

export const ASK_GLOBEE = {
  pageTitle: "Messages",
  headline: "Ask Globee",
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
} as const;

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
  return isAskGlobeeUnlocked(input.tier) ? "ask-globee-thread" : "access-gate";
}

export function canRenderAskGlobeeThread(surface: MessagesSurface): boolean {
  return surface === "ask-globee-thread";
}

export function showMessagesHeaderSearch(surface: MessagesSurface): boolean {
  return surface === "access-gate";
}
