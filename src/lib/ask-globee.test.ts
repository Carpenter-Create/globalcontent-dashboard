import { describe, expect, it } from "vitest";

import { USER_MENU } from "@/lib/user-menu";
import {
  ASK_GLOBEE,
  ASK_GLOBEE_TRY_PROMPTS,
  canRenderAskGlobeeLanding,
  canRenderAskGlobeeThread,
  isAskGlobeeTier,
  isAskGlobeeUnlocked,
  resolveMessagesSurface,
  showMessagesHeaderSearch,
} from "@/lib/ask-globee";

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

  it("keeps the 247:295 fixture lines", () => {
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
