import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { AskGlobeeThinking } from "./ask-globee-thinking";

describe("AskGlobeeThinking", () => {
  it("locks 246:296 Esc/stop chrome without a fake pause", () => {
    const html = renderToStaticMarkup(<AskGlobeeThinking onStop={() => undefined} />);
    expect(html).toContain('data-ask-globee-thinking=""');
    expect(html).toContain('data-ask-globee-stop=""');
    expect(html).toContain(ASK_GLOBEE.thinking);
    expect(html).toContain(ASK_GLOBEE.stop);
    expect(html).toContain(ASK_GLOBEE.stopHint);
    expect(html).toContain(ASK_GLOBEE.globeeMark);
    expect(html).not.toContain(ASK_GLOBEE.capability);
    expect(html).not.toContain("Winter Line");
  });
});
