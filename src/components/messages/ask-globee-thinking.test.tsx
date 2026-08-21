import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ASK_GLOBEE,
  ASK_GLOBEE_FETCHING_HOLD_MS,
  askGlobeeThinkingPhase,
} from "@/lib/ask-globee";
import { AskGlobeeThinking } from "./ask-globee-thinking";

describe("AskGlobeeThinking", () => {
  it("locks 427:352 empty-lead fetching chrome without a side-line Stop", () => {
    const html = renderToStaticMarkup(
      <AskGlobeeThinking phase={askGlobeeThinkingPhase(0)} />,
    );
    expect(html).toContain('data-ask-globee-thinking=""');
    expect(html).toContain('data-ask-globee-lead-slot=""');
    expect(html).toContain('data-ask-globee-thinking-verb=""');
    expect(html).toContain(ASK_GLOBEE.fetchingSkills);
    expect(html).toContain("…");
    expect(html).toContain(ASK_GLOBEE.globeeMark);
    expect(html).toContain("size-6");
    expect(html).toContain("bg-accent");
    expect(html).toContain("min-h-6");
    expect(html).toContain("t-body-sm text-ink-3");
    expect(html).not.toContain("text-ink-3/55");
    expect(html).not.toContain("data-ask-globee-handoff");
    expect(html).not.toContain(ASK_GLOBEE.findingSignal);
    expect(html).not.toContain(ASK_GLOBEE.thinking);
    expect(html).not.toContain(ASK_GLOBEE.stop);
    expect(html).not.toContain(ASK_GLOBEE.stopHint);
    expect(html).not.toContain(ASK_GLOBEE.escToCancel);
    expect(html).not.toContain(ASK_GLOBEE.capability);
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Looking at");
  });

  it("mounts finding-the-signal chrome after the fetching hold, even without a lead", () => {
    const html = renderToStaticMarkup(
      <AskGlobeeThinking phase={askGlobeeThinkingPhase(ASK_GLOBEE_FETCHING_HOLD_MS)} />,
    );
    expect(html).toContain('data-ask-globee-thinking=""');
    expect(html).toContain('data-ask-globee-handoff=""');
    expect(html).toContain('data-ask-globee-lead-slot=""');
    expect(html).toContain(ASK_GLOBEE.findingSignal);
    expect(html).toContain("…");
    expect(html).toContain("t-body-sm text-ink-3/55");
    expect(html).not.toContain(ASK_GLOBEE.fetchingSkills);
    expect(html).not.toContain("t-body leading-6 text-ink");
    expect(html).not.toContain(ASK_GLOBEE.thinking);
    expect(html).not.toContain(ASK_GLOBEE.stop);
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Looking at");
    expect(html).not.toContain(ASK_GLOBEE.answerLead);
  });

  it("locks 427:440 handoff chrome for a live catalog lead on finding", () => {
    const html = renderToStaticMarkup(
      <AskGlobeeThinking
        phase={askGlobeeThinkingPhase(ASK_GLOBEE_FETCHING_HOLD_MS)}
        lead="Harbor Cut — Synopsis is required."
      />,
    );
    expect(html).toContain('data-ask-globee-thinking=""');
    expect(html).toContain('data-ask-globee-handoff=""');
    expect(html).toContain("Harbor Cut — Synopsis is required.");
    expect(html).toContain("t-body leading-6 text-ink");
    expect(html).toContain(ASK_GLOBEE.findingSignal);
    expect(html).toContain("…");
    expect(html).toContain("t-body-sm text-ink-3/55");
    expect(html).not.toContain('data-ask-globee-lead-slot=""');
    expect(html).not.toContain(ASK_GLOBEE.fetchingSkills);
    expect(html).not.toContain(ASK_GLOBEE.thinking);
    expect(html).not.toContain(ASK_GLOBEE.stop);
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Looking at");
  });
});
