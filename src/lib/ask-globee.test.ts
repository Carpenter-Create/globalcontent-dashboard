import { describe, expect, it } from "vitest";

import { USER_MENU } from "@/lib/user-menu";
import {
  ASK_GLOBEE,
  ASK_GLOBEE_TRY_PROMPTS,
  askGlobeeChipActivation,
  askGlobeeComposerSubmit,
  askGlobeeConversationTitle,
  askGlobeeLandingHref,
  askGlobeeSelectedChip,
  askGlobeeThreadHref,
  canRenderAskGlobeeLanding,
  canRenderAskGlobeeThread,
  isAskGlobeeTier,
  isAskGlobeeThreadId,
  isAskGlobeeUnlocked,
  messagesShowsThreadHeader,
  readAskGlobeePrompt,
  readAskGlobeeThreadId,
  resolveMessagesSurface,
  showMessagesHeaderSearch,
} from "@/lib/ask-globee";

const THREAD = "2f1c8b6a-4d3e-4a11-9c22-7b8e1d0a5f44";

describe("Ask Globee copy lock", () => {
  it("keeps the Access gate lines and Upgrade path", () => {
    expect(ASK_GLOBEE.headline).toBe("Ask Globee");
    expect(ASK_GLOBEE.analyze).toBe("Analyze anything about your catalog.");
    expect(ASK_GLOBEE.included).toBe("Included with Pro and Premium.");
    expect(ASK_GLOBEE.upgrade).toBe("Upgrade");
    expect(ASK_GLOBEE.upgradeHref).toBe("/account/agreements");
    expect(ASK_GLOBEE.upgradeHref).toBe(USER_MENU.agreementsHref);
  });

  it("keeps the 7:73 landing lines and generic try chips", () => {
    expect(ASK_GLOBEE.need).toBe("What do you need?");
    expect(ASK_GLOBEE.tryLabel).toBe("Try one of these");
    expect(ASK_GLOBEE.historyLabel).toBe("History");
    expect(ASK_GLOBEE.tryPrompts).toEqual([
      "What needs attention",
      "What is blocking a title",
      "What should I submit next",
    ]);
    expect(ASK_GLOBEE.tryPrompts).toBe(ASK_GLOBEE_TRY_PROMPTS);
    expect(ASK_GLOBEE.composerPlaceholder).toBe("Ask a question or give a command.");
    for (const label of ASK_GLOBEE.tryPrompts) {
      expect(label).not.toMatch(/Winter Line|Harbor Lights|Get support/i);
    }
  });

  it("keeps the honest capability, empty-catalog, and drawn menu lines", () => {
    expect(ASK_GLOBEE.capability).toBe(
      "I can answer catalog attention, blockers, and what to submit next.",
    );
    expect(ASK_GLOBEE.emptyBlocking).toBe("Nothing required is blocking a title.");
    expect(ASK_GLOBEE.emptySubmitNext).toBe("Nothing is ready to submit next.");
    expect(ASK_GLOBEE.attributionName).toBe("Globee AI");
    expect(ASK_GLOBEE.renameLabel).toBe("Rename");
    expect(ASK_GLOBEE.pinLabel).toBe("Pin");
    expect(ASK_GLOBEE.deleteLabel).toBe("Delete");
    expect(ASK_GLOBEE.deleteTitle).toBe("Delete conversation");
    expect(ASK_GLOBEE.deleteBody).toBe(
      "This permanently deletes the conversation. It cannot be undone.",
    );
    expect(ASK_GLOBEE.deleteConfirm).toBe("Delete");
    expect(ASK_GLOBEE.cancelLabel).toBe("Cancel");
    expect(JSON.stringify(ASK_GLOBEE)).not.toMatch(/Archive/i);
  });

  it("keeps the 247:295 fixture lines as a do-not-render lock", () => {
    expect(ASK_GLOBEE.threadTitle).toBe("What's blocking The Winter Line");
    expect(ASK_GLOBEE.userPrompt).toBe("What's blocking The Winter Line?");
    expect(ASK_GLOBEE.answerLead).toBe(
      "The Winter Line is missing Genre. Genre is required before it can go live.",
    );
    expect(ASK_GLOBEE.answerFollow).toBe(
      "Synopsis and Runtime are also required. Director is recommended.",
    );
    expect(ASK_GLOBEE.attribution).toBe("Globee AI · 7:10 AM");
    expect(ASK_GLOBEE.composerPlaceholder).toBe("Ask a question or give a command.");
  });
});

describe("isAskGlobeeTier / isAskGlobeeUnlocked", () => {
  it("accepts only the existing tier vocabulary", () => {
    expect(isAskGlobeeTier("access")).toBe(true);
    expect(isAskGlobeeTier("pro")).toBe(true);
    expect(isAskGlobeeTier("premium")).toBe(true);
    expect(isAskGlobeeTier(null)).toBe(false);
    expect(isAskGlobeeTier("enterprise")).toBe(false);
  });

  it("unlocks only pro and premium", () => {
    expect(isAskGlobeeUnlocked("access")).toBe(false);
    expect(isAskGlobeeUnlocked(null)).toBe(false);
    expect(isAskGlobeeUnlocked("pro")).toBe(true);
    expect(isAskGlobeeUnlocked("premium")).toBe(true);
  });
});

describe("resolveMessagesSurface", () => {
  it("keeps staff without a client org on the notification inbox", () => {
    expect(
      resolveMessagesSurface({ isGcStaff: true, hasActiveOrg: false, tier: null }),
    ).toBe("staff-inbox");
  });

  it("defaults a missing or Access tier to the upgrade gate", () => {
    expect(
      resolveMessagesSurface({ isGcStaff: false, hasActiveOrg: true, tier: null }),
    ).toBe("access-gate");
    expect(
      resolveMessagesSurface({ isGcStaff: false, hasActiveOrg: true, tier: "access" }),
    ).toBe("access-gate");
    expect(
      resolveMessagesSurface({ isGcStaff: true, hasActiveOrg: true, tier: "access" }),
    ).toBe("access-gate");
  });

  it("unlocks the 7:73 landing only for pro or premium", () => {
    expect(
      resolveMessagesSurface({ isGcStaff: false, hasActiveOrg: true, tier: "pro" }),
    ).toBe("ask-globee-landing");
    expect(
      resolveMessagesSurface({ isGcStaff: true, hasActiveOrg: true, tier: "premium" }),
    ).toBe("ask-globee-landing");
  });

  it("never treats staff-without-org as a client gate, landing, or thread", () => {
    const surface = resolveMessagesSurface({
      isGcStaff: true,
      hasActiveOrg: false,
      tier: "premium",
    });
    expect(surface).toBe("staff-inbox");
    expect(canRenderAskGlobeeLanding(surface)).toBe(false);
    expect(canRenderAskGlobeeThread(surface)).toBe(false);
    expect(showMessagesHeaderSearch(surface)).toBe(false);
  });
});

describe("canRenderAskGlobeeThread / showMessagesHeaderSearch", () => {
  it("locks the thread, landing, and header Search to the authorized surfaces", () => {
    expect(canRenderAskGlobeeLanding("ask-globee-landing")).toBe(true);
    expect(canRenderAskGlobeeLanding("access-gate")).toBe(false);
    expect(canRenderAskGlobeeLanding("staff-inbox")).toBe(false);
    expect(canRenderAskGlobeeLanding("ask-globee-thread")).toBe(false);

    expect(canRenderAskGlobeeThread("access-gate")).toBe(false);
    expect(canRenderAskGlobeeThread("staff-inbox")).toBe(false);
    expect(canRenderAskGlobeeThread("ask-globee-landing")).toBe(false);
    expect(canRenderAskGlobeeThread("ask-globee-thread")).toBe(true);

    expect(showMessagesHeaderSearch("access-gate")).toBe(true);
    expect(showMessagesHeaderSearch("ask-globee-landing")).toBe(false);
    expect(showMessagesHeaderSearch("ask-globee-thread")).toBe(false);
    expect(showMessagesHeaderSearch("staff-inbox")).toBe(false);
  });
});

describe("Ask Globee send helpers", () => {
  it("chip activation fills, selects, and sends the same label", () => {
    const activation = askGlobeeChipActivation("What needs attention");
    expect(activation).toEqual({
      prompt: "What needs attention",
      selected: "What needs attention",
      send: "What needs attention",
    });
  });

  it("composer submit sends a trimmed prompt and ignores blanks", () => {
    expect(askGlobeeComposerSubmit("  What needs attention  ")).toBe("What needs attention");
    expect(askGlobeeComposerSubmit("   ")).toBeNull();
  });

  it("opens a persisted thread by id, never a ?q= rewrite", () => {
    expect(isAskGlobeeThreadId(THREAD)).toBe(true);
    expect(askGlobeeThreadHref(THREAD)).toBe(`/messages?thread=${THREAD}`);
    expect(askGlobeeThreadHref("What needs attention")).toBeNull();
    expect(askGlobeeThreadHref("   ")).toBeNull();
    expect(readAskGlobeeThreadId({ thread: THREAD })).toBe(THREAD);
    expect(readAskGlobeeThreadId(new URLSearchParams(`thread=${THREAD}`))).toBe(THREAD);
    expect(readAskGlobeeThreadId({ thread: "not-a-uuid" })).toBeNull();
    expect(readAskGlobeeThreadId({ q: "What needs attention" })).toBeNull();
    expect(readAskGlobeePrompt({ q: "What needs attention" })).toBe("What needs attention");
    expect(askGlobeeLandingHref()).toBe("/messages");
    expect(askGlobeeSelectedChip("  what needs attention  ")).toBe("What needs attention");
    expect(askGlobeeSelectedChip("unmapped")).toBeNull();
  });

  it("truncates a long first prompt into the conversation title", () => {
    const long = "What needs attention on every title in this catalog right now and later";
    expect(askGlobeeConversationTitle("  What needs attention  ")).toBe("What needs attention");
    expect(askGlobeeConversationTitle(long).endsWith("…")).toBe(true);
    expect(askGlobeeConversationTitle(long).length).toBeLessThanOrEqual(80);
  });

  it("shows the thread header only for an unlocked surface with a thread id", () => {
    expect(messagesShowsThreadHeader("access-gate", THREAD)).toBe(false);
    expect(messagesShowsThreadHeader("staff-inbox", THREAD)).toBe(false);
    expect(messagesShowsThreadHeader("ask-globee-landing", null)).toBe(false);
    expect(messagesShowsThreadHeader("ask-globee-landing", THREAD)).toBe(true);
    expect(messagesShowsThreadHeader("ask-globee-thread", null)).toBe(true);
  });
});
