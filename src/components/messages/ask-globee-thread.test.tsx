import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(),
}));

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { CATALOG_HEALTH_EMPTY } from "@/lib/findings";
import { AskGlobeeThread } from "./ask-globee-thread";

function visible(html: string): string {
  return html.replaceAll("&#x27;", "'");
}

const ANSWER = {
  intent: "attention" as const,
  lead: "Harbor Cut — Synopsis is required.",
  follow: null,
  titleNames: ["Harbor Cut"],
};

describe("AskGlobeeThread", () => {
  it("locks 247:295 chrome around the caller's prompt, not the Winter Line fixture", () => {
    const html = visible(
      renderToStaticMarkup(
        <AskGlobeeThread initials="A" prompt="What needs attention" answer={ANSWER} />,
      ),
    );

    expect(html).toContain('data-ask-globee-thread=""');
    expect(html).toContain("What needs attention");
    expect(html).toContain("Harbor Cut — Synopsis is required.");
    expect(html).toContain(ASK_GLOBEE.globeeMark);
    expect(html).toContain(ASK_GLOBEE.attributionName);
    expect(html).toContain(ASK_GLOBEE.composerPlaceholder);
    expect(html).toContain(">A<");
    expect(html).toContain("max-w-[640px]");
    expect(html).toContain("px-[var(--content-inset)]");
    expect(html).toContain("bg-surface-muted");
    expect(html).toContain("bg-accent");
    expect(html).not.toContain(ASK_GLOBEE.userPrompt);
    expect(html).not.toContain(ASK_GLOBEE.answerLead);
    expect(html).not.toContain(ASK_GLOBEE.answerFollow);
    expect(html).not.toContain(ASK_GLOBEE.attribution);
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Harbor Lights");
  });

  it("can render the honest empty-catalog line", () => {
    const html = visible(
      renderToStaticMarkup(
        <AskGlobeeThread
          initials="A"
          prompt="What needs attention"
          answer={{
            intent: "attention",
            lead: CATALOG_HEALTH_EMPTY,
            follow: null,
            titleNames: [],
          }}
        />,
      ),
    );
    expect(html).toContain(CATALOG_HEALTH_EMPTY);
    expect(html).not.toContain("Artwork missing");
  });

  it("does not restore header Search or the Access upgrade card", () => {
    const html = renderToStaticMarkup(
      <AskGlobeeThread initials="A" prompt="What needs attention" answer={ANSWER} />,
    );

    expect(html).not.toContain("SearchField");
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain(ASK_GLOBEE.analyze);
    expect(html).not.toContain(ASK_GLOBEE.included);
    expect(html).not.toContain(`href="${ASK_GLOBEE.upgradeHref}"`);
    expect(html).not.toContain("data-ask-globee-gate");
    expect(html).not.toContain("data-ask-globee-upgrade");
  });
});
