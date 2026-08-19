import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { AskGlobeeThread } from "./ask-globee-thread";

describe("AskGlobeeThread", () => {
  it("locks the 247:295 answered fixture", () => {
    const html = renderToStaticMarkup(<AskGlobeeThread initials="A" />);

    expect(html).toContain('data-ask-globee-thread=""');
    expect(html).toContain('data-ask-globee-thread-header=""');
    expect(html).toContain(ASK_GLOBEE.threadTitle);
    expect(html).toContain(ASK_GLOBEE.userPrompt);
    expect(html).toContain(ASK_GLOBEE.answerLead);
    expect(html).toContain(ASK_GLOBEE.answerFollow);
    expect(html).toContain(ASK_GLOBEE.attribution);
    expect(html).toContain(ASK_GLOBEE.globeeMark);
    expect(html).toContain(ASK_GLOBEE.composerPlaceholder);
    expect(html).toContain(">A<");
    expect(html).toContain("max-w-[640px]");
  });

  it("does not restore header Search or the Access upgrade card", () => {
    const html = renderToStaticMarkup(<AskGlobeeThread initials="A" />);

    expect(html).not.toContain("SearchField");
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain(ASK_GLOBEE.analyze);
    expect(html).not.toContain(ASK_GLOBEE.included);
    expect(html).not.toContain(`href="${ASK_GLOBEE.upgradeHref}"`);
    expect(html).not.toContain("data-ask-globee-gate");
    expect(html).not.toContain("data-ask-globee-upgrade");
  });
});
