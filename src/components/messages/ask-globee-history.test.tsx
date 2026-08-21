import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { AskGlobeeHistoryPanel } from "./ask-globee-history";

function visible(html: string): string {
  return html.replaceAll("&#x27;", "'");
}

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ask-globee-history.tsx"), "utf8");
const THREAD = "2f1c8b6a-4d3e-4a11-9c22-7b8e1d0a5f44";
const OLDER = "5c4f1e9d-7a61-4d44-8f55-0e1b4a3d8c77";
const NOW = new Date(2026, 7, 19, 15, 10, 0);

describe("AskGlobeeHistoryPanel", () => {
  it("locks the 384 hairline popover craft with search and groups", () => {
    const html = visible(
      renderToStaticMarkup(
        <AskGlobeeHistoryPanel
          conversations={[
            {
              id: THREAD,
              title: "What needs attention",
              pinned_at: null,
              created_at: "2026-08-19T11:00:00.000Z",
              updated_at: new Date(2026, 7, 19, 7, 10, 0).toISOString(),
            },
            {
              id: OLDER,
              title: "What should I submit next",
              pinned_at: null,
              created_at: "2026-08-01T11:00:00.000Z",
              updated_at: new Date(2026, 7, 1, 7, 10, 0).toISOString(),
            },
          ]}
          currentId={THREAD}
          now={NOW}
        />,
      ),
    );

    expect(html).toContain("data-ask-globee-history-popover");
    expect(html).toContain("w-[384px]");
    expect(html).toContain("border-hairline");
    expect(html).toContain("rounded-[12px]");
    expect(html).toContain("p-[var(--space-6)]");
    expect(html).toContain("gap-[var(--space-6)]");
    expect(html).toContain("shadow-none");
    expect(html).not.toContain("shadow-[");
    expect(html).toContain(ASK_GLOBEE.historySearchPlaceholder);
    expect(html).toContain("bg-transparent");
    expect(html).toContain(ASK_GLOBEE.thisWeekLabel);
    expect(html).toContain(ASK_GLOBEE.allThreadsLabel);
    expect(html).toContain("t-label text-ink-3");
    expect(html).toContain("t-body text-ink");
    expect(html).toContain("t-body-sm text-ink-3");
    expect(html).toContain("What needs attention");
    expect(html).toContain("What should I submit next");
    expect(html).toContain("data-ask-globee-history-current");
    expect(html).toContain("border border-hairline bg-transparent");
    expect(html).toContain(`/messages?thread=${THREAD}`);
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Harbor Lights");
    expect(html).not.toContain("Get support");
    expect(src).toContain("shadow-none");
    expect(src).toContain("conversations");
    expect(src).not.toMatch(/title:\s*"What's blocking/);
  });

  it("renders empty history as empty, with no fixture rows", () => {
    const html = visible(
      renderToStaticMarkup(
        <AskGlobeeHistoryPanel conversations={[]} now={NOW} />,
      ),
    );

    expect(html).toContain("data-ask-globee-history-popover");
    expect(html).toContain(ASK_GLOBEE.historySearchPlaceholder);
    expect(html).not.toContain("data-ask-globee-history-row");
    expect(html).not.toContain(ASK_GLOBEE.thisWeekLabel);
    expect(html).not.toContain(ASK_GLOBEE.allThreadsLabel);
    expect(html).not.toContain("Winter Line");
    expect(html).not.toContain("Harbor Lights");
    expect(html).not.toContain("Get support");
    expect(html).not.toContain(ASK_GLOBEE.historyLabel);
  });
});
