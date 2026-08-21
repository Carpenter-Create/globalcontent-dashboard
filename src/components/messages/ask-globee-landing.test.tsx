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

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ask-globee-landing.tsx"), "utf8");
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
    expect(html).toContain(ASK_GLOBEE.tryLabel);
    expect(html).toContain('data-ask-globee-chip=""');
    expect(html).toContain("aria-pressed");
    for (const label of ASK_GLOBEE.tryPrompts) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("data-ask-globee-history");
    expect(html).not.toContain(ASK_GLOBEE.historyLabel);
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Harbor Lights");
    expect(html).not.toContain("Get support");
    expect(html).not.toContain("data-ask-globee-thread");
    expect(html).not.toContain(ASK_GLOBEE.userPrompt);
    expect(html).not.toContain(ASK_GLOBEE.answerLead);
    expect(html).not.toContain(ASK_GLOBEE.attribution);
  });

  it("renders real HISTORY rows for this org only", () => {
    const html = visible(
      renderToStaticMarkup(
        <AskGlobeeLanding
          conversations={[
            {
              id: THREAD,
              title: "What needs attention",
              pinned_at: "2026-08-19T12:00:00.000Z",
              created_at: "2026-08-19T11:00:00.000Z",
              updated_at: "2026-08-19T12:00:00.000Z",
            },
          ]}
        />,
      ),
    );
    expect(html).toContain("data-ask-globee-history");
    expect(html).toContain("data-ask-globee-history-row");
    expect(html).toContain("What needs attention");
    expect(html).toContain(`/messages?thread=${THREAD}`);
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Harbor Lights");
    expect(html).not.toContain("Get support");
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
    expect(src).toContain("askGlobeeUsesModel(value)");
    expect(src).toContain("AskGlobeeThinking");
    expect(src).toContain("if (askGlobeeUsesModel(value)) setThinking(true)");
    expect(src).not.toContain("router.replace");
    expect(src).not.toContain("AskGlobeeThread");
    expect(src).not.toContain(ASK_GLOBEE.answerLead);
    expect(src).not.toContain("ANTHROPIC");
    expect(src).not.toContain("ask-globee-operator");
    expect(src).not.toMatch(/setTimeout|sleep\(/);
  });
});
