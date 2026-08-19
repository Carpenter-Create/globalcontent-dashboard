import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { AccessUpgradeGate } from "./access-upgrade-gate";
import { AskGlobeeThread } from "./ask-globee-thread";

describe("AccessUpgradeGate", () => {
  it("renders Ask Globee at display size with the two locked lines and Upgrade", () => {
    const html = renderToStaticMarkup(<AccessUpgradeGate />);

    expect(html).toContain('data-ask-globee-gate=""');
    expect(html).toContain('data-ask-globee-headline=""');
    expect(html).toContain("t-display");
    expect(html).toContain(ASK_GLOBEE.headline);
    expect(html).toContain(ASK_GLOBEE.analyze);
    expect(html).toContain(ASK_GLOBEE.included);
    expect(html).toContain(ASK_GLOBEE.upgrade);
    expect(html).toContain(`href="${ASK_GLOBEE.upgradeHref}"`);
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain("SearchField");
  });

  it("does not render a ghost conversation, blur, chips, composer, or the Pro thread", () => {
    const html = renderToStaticMarkup(<AccessUpgradeGate />);
    const thread = renderToStaticMarkup(<AskGlobeeThread initials="A" />);

    expect(html).not.toContain("data-ask-globee-thread");
    expect(html).not.toContain("data-ask-globee-composer");
    expect(html).not.toContain(ASK_GLOBEE.threadTitle);
    expect(html).not.toContain(ASK_GLOBEE.answerLead);
    expect(html).not.toContain(ASK_GLOBEE.attribution);
    expect(html).not.toContain(ASK_GLOBEE.composerPlaceholder);
    expect(html).not.toContain(ASK_GLOBEE.need);
    expect(html).not.toContain(ASK_GLOBEE.tryLabel);
    expect(html).not.toContain("data-ask-globee-landing");
    expect(html).not.toContain("data-ask-globee-chip");
    for (const label of ASK_GLOBEE.tryPrompts) {
      expect(html).not.toContain(label);
    }
    expect(html).not.toMatch(/blur|backdrop-blur|ghost/i);
    expect(html).not.toContain("chip");

    expect(thread).toContain("data-ask-globee-thread");
    expect(html).not.toContain("data-ask-globee-user-row");
  });
});
