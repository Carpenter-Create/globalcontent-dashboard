import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { AskGlobeeLanding } from "./ask-globee-landing";

function visible(html: string): string {
  return html.replaceAll("&#x27;", "'");
}

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ask-globee-landing.tsx"), "utf8");

describe("AskGlobeeLanding", () => {
  it("locks the 7:73 landing chrome without History or the answered fixture", () => {
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
    for (const label of ASK_GLOBEE.tryPrompts) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("HISTORY");
    expect(html).not.toContain("History");
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Harbor Lights");
    expect(html).not.toContain("Get support");
    expect(html).not.toContain("data-ask-globee-thread");
    expect(html).not.toContain(ASK_GLOBEE.userPrompt);
    expect(html).not.toContain(ASK_GLOBEE.answerLead);
    expect(html).not.toContain(ASK_GLOBEE.attribution);
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

  it("fills the composer from chips and does not navigate or invent an answer", () => {
    const html = renderToStaticMarkup(<AskGlobeeLanding />);

    expect(html).toContain('type="button"');
    expect(html).not.toContain("href=");
    expect(src).toContain("setPrompt(label)");
    expect(src).toContain("event.preventDefault()");
    expect(src).not.toContain("router");
    expect(src).not.toContain("AskGlobeeThread");
    expect(src).not.toContain(ASK_GLOBEE.answerLead);
  });
});
