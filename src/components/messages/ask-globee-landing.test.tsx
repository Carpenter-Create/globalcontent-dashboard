import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/messages/ask-globee-actions", () => ({
  startAskGlobeeConversation: vi.fn(),
}));

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { AskGlobeeLanding } from "./ask-globee-landing";

function visible(html: string): string {
  return html.replaceAll("&#x27;", "'");
}

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "ask-globee-landing.tsx"), "utf8");
const tokens = readFileSync(join(here, "../../app/tokens.css"), "utf8");
const THREAD = "2f1c8b6a-4d3e-4a11-9c22-7b8e1d0a5f44";

describe("AskGlobeeLanding", () => {
  it("locks the 7:73 landing chrome without fixture History rows", () => {
    const html = visible(renderToStaticMarkup(<AskGlobeeLanding />));

    expect(html).toContain('data-ask-globee-landing=""');
    expect(html).toContain("t-display");
    expect(html).toContain(ASK_GLOBEE.headline);
    expect(html).toContain(ASK_GLOBEE.need);
    expect(html).toContain(ASK_GLOBEE.composerPlaceholder);
    expect(html).toContain("max-w-[640px]");
    expect(html).toContain("h-14");
    expect(html).toContain("rounded-[28px]");
    expect(html).toContain("px-[var(--space-4)]");
    expect(html).toContain(ASK_GLOBEE.tryLabel);
    expect(html).toContain('data-ask-globee-chip=""');
    expect(html).toContain("aria-pressed");
    expect(html).toContain('data-ask-globee-clock=""');
    expect(html).toContain(ASK_GLOBEE.pastConversationsLabel);
    expect(html).not.toContain("data-ask-globee-download");
    expect(html).not.toContain(ASK_GLOBEE.downloadLabel);
    expect(src).not.toContain("Download");
    expect(html).not.toContain("data-ask-globee-new");
    expect(html).not.toContain(ASK_GLOBEE.newConversationLabel);
    expect(html).not.toContain('href="/messages"');
    expect(html).toContain("text-ink-3");
    expect(html).toContain("stroke-width=\"1.33\"");
    for (const label of ASK_GLOBEE.tryPrompts) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("data-ask-globee-history-popover");
    expect(html).not.toContain("data-ask-globee-history-row");
    expect(html).not.toContain(ASK_GLOBEE.historyLabel);
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Harbor Lights");
    expect(html).not.toContain("Get support");
    expect(html).not.toContain("data-ask-globee-thread");
    expect(html).not.toContain("data-ask-globee-thinking");
    expect(html).not.toContain(ASK_GLOBEE.thinking);
    expect(html).not.toContain(ASK_GLOBEE.fetchingSkills);
    expect(html).not.toContain(ASK_GLOBEE.findingSignal);
    expect(html).not.toContain(ASK_GLOBEE.escToCancel);
    expect(html).not.toContain(ASK_GLOBEE.userPrompt);
    expect(html).not.toContain(ASK_GLOBEE.answerLead);
    expect(html).not.toContain(ASK_GLOBEE.attribution);
  });

  it("never renders thinking chrome on send", () => {
    const html = renderToStaticMarkup(<AskGlobeeLanding />);

    expect(html).not.toContain("data-ask-globee-thinking");
    expect(html).not.toContain(ASK_GLOBEE.thinking);
    expect(html).not.toContain(ASK_GLOBEE.fetchingSkills);
    expect(html).not.toContain(ASK_GLOBEE.findingSignal);
    expect(html).not.toContain(ASK_GLOBEE.stop);
    expect(html).not.toContain(ASK_GLOBEE.stopHint);
    expect(html).not.toContain(ASK_GLOBEE.escToCancel);
    expect(src).toContain("startAskGlobeeConversation");
    expect(src).toContain("router.push(href)");
    expect(src).toContain("askGlobeeThreadHref");
    expect(src).not.toContain("AskGlobeeThinking");
    expect(src).not.toContain("data-ask-globee-thinking");
    expect(src).not.toContain("fetching relevant skills");
    expect(src).not.toContain("finding the signal");
    expect(src).not.toContain("setThinking");
    expect(src).not.toContain("askGlobeeUsesModel");
    expect(src).not.toContain("completeAskGlobeeTurn");
    expect(src).not.toContain("emptyBlocking");
  });

  it("keeps clock on landing, drops plus, and never lists HISTORY rows", () => {
    const html = visible(
      renderToStaticMarkup(
        <AskGlobeeLanding
          conversations={[
            {
              id: THREAD,
              title: "How many titles are in this catalog",
              pinned_at: "2026-08-19T12:00:00.000Z",
              created_at: "2026-08-19T11:00:00.000Z",
              updated_at: "2026-08-19T12:00:00.000Z",
            },
          ]}
        />,
      ),
    );
    expect(html).toContain("data-ask-globee-clock");
    expect(html).toContain("size-4");
    expect(src).toContain("<Clock className=\"size-4\" strokeWidth={1.33} />");
    expect(src).toContain("text-ink-3");
    expect(html).not.toContain("data-ask-globee-new");
    expect(html).not.toContain(ASK_GLOBEE.newConversationLabel);
    expect(html).toContain(ASK_GLOBEE.headline);
    expect(html).toContain(ASK_GLOBEE.need);
    expect(html).toContain(ASK_GLOBEE.tryLabel);
    for (const label of ASK_GLOBEE.tryPrompts) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("data-ask-globee-history-popover");
    expect(html).not.toContain("data-ask-globee-history-row");
    expect(html).not.toContain(ASK_GLOBEE.historyLabel);
    expect(html).not.toContain("How many titles are in this catalog");
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Harbor Lights");
    expect(html).not.toContain("Get support");
    expect(src).toContain("AskGlobeeHistoryPopover");
    expect(src).toContain("conversations={conversations}");
    expect(src).toContain("Clock");
    expect(src).toContain("strokeWidth={1.33}");
    expect(src).not.toContain("Plus");
    expect(src).not.toContain("data-ask-globee-new");
    expect(src).not.toContain("ASK_GLOBEE.newConversationLabel");
    expect(src).not.toContain("askGlobeeLandingHref");
    expect(src).not.toContain("ASK_GLOBEE.historyLabel");
    expect(src).not.toContain("data-ask-globee-history-row");
  });

  it("does not restore header Search or the Access upgrade card", () => {
    const html = renderToStaticMarkup(<AskGlobeeLanding />);

    expect(html).not.toContain("SearchField");
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain(ASK_GLOBEE.analyze);
    expect(html).not.toContain(ASK_GLOBEE.included);
    expect(html).not.toContain(`href="${ASK_GLOBEE.upgradeHref}"`);
    expect(html).not.toContain("data-ask-globee-gate");
    expect(html).not.toContain("data-ask-globee-upgrade");
  });

  it("fills, selects, and sends from chips, and submit sends a persisted thread", () => {
    const html = renderToStaticMarkup(<AskGlobeeLanding />);

    expect(html).toContain('type="button"');
    expect(html).toContain('aria-pressed="false"');
    expect(src).toContain("askGlobeeChipActivation(label)");
    expect(src).toContain("setPrompt(activation.prompt)");
    expect(src).toContain("send(activation.send)");
    expect(src).toContain("askGlobeeComposerSubmit(prompt)");
    expect(src).toContain("startAskGlobeeConversation");
    expect(src).toContain("router.push(href)");
    expect(src).toContain("askGlobeeThreadHref");
    expect(src).toContain("aria-pressed={pressed}");
    expect(src).not.toContain("askGlobeeUsesModel");
    expect(src).not.toContain("AskGlobeeThinking");
    expect(src).not.toContain("setThinking");
    expect(src).not.toContain("data-ask-globee-thinking");
    expect(src).not.toContain("router.replace");
    expect(src).not.toContain("AskGlobeeThread");
    expect(src).not.toContain(ASK_GLOBEE.answerLead);
    expect(src).not.toContain("ANTHROPIC");
    expect(src).not.toContain("ask-globee-operator");
    expect(src).not.toMatch(/setTimeout|sleep\(/);
  });

  it("locks 7:73 greeting, well, composer, and chip geometry on the house 8/16/24/48 scale", () => {
    const html = renderToStaticMarkup(<AskGlobeeLanding />);

    expect(tokens).toContain("--space-12: 3rem;");
    expect(src).toContain(
      "relative flex min-h-[min(36rem,calc(100dvh-var(--header-height)-var(--content-inset)*2))] flex-col items-center justify-center p-[var(--space-12)]",
    );
    expect(src).toContain("flex w-full flex-col items-center gap-[var(--space-12)]");
    expect(src).toContain("flex flex-col items-center gap-[var(--space-6)]");
    expect(html).toContain("t-body text-center text-ink-2");
    expect(src).toContain(
      "flex h-14 w-full max-w-[640px] items-center justify-between rounded-[28px] border border-hairline bg-surface px-[var(--space-4)]",
    );
    expect(src).toContain(
      "inline-flex items-center rounded-full border bg-surface px-[var(--space-4)] py-[var(--space-2)] t-body-sm text-ink",
    );
    expect(src).not.toContain("gap-[var(--space-8)]");
    expect(src).not.toContain("rounded-full border border-hairline bg-surface px-[var(--space-4)]");
    expect(src).not.toContain("p-[var(--space-8)]");
    expect(src).not.toContain("p-[var(--space-10)]");
    expect(src).not.toContain("rounded-[12px]");
    expect(src).not.toContain("rounded-[20px]");
    expect(src).not.toContain("rounded-[32px]");
    expect(src).not.toContain("rounded-[40px]");
    expect(html).not.toContain("data-ask-globee-new");
    expect(html).not.toContain(ASK_GLOBEE.historyLabel);
    expect(html).toContain('data-ask-globee-clock=""');
  });
});
