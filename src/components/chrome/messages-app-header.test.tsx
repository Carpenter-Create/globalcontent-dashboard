import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("@/app/(app)/messages/ask-globee-actions", () => ({
  startAskGlobeeConversation: vi.fn(),
  appendAskGlobeeTurn: vi.fn(),
  completeAskGlobeeTurn: vi.fn(),
  setAskGlobeeThumb: vi.fn(),
  renameAskGlobeeConversation: vi.fn(),
  pinAskGlobeeConversation: vi.fn(),
  deleteAskGlobeeConversation: vi.fn(),
}));

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { AskGlobeeChromeProvider } from "@/components/messages/ask-globee-chrome";
import { MessagesAppHeader } from "./messages-app-header";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "messages-app-header.tsx"), "utf8");

const THREAD = "2f1c8b6a-4d3e-4a11-9c22-7b8e1d0a5f44";

function visible(html: string): string {
  return html.replaceAll("&#x27;", "'");
}

describe("MessagesAppHeader", () => {
  it("restores Search only on the Access gate, even with a thread query", () => {
    navigation.search = `thread=${THREAD}`;
    const html = renderToStaticMarkup(<MessagesAppHeader surface="access-gate" />);
    expect(html).toContain("data-header-search");
    expect(html).toContain(ASK_GLOBEE.headerSearchPlaceholder);
    expect(html).toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain("data-header-thread");
    expect(html).not.toContain(ASK_GLOBEE.threadTitle);
    expect(html).not.toContain(ASK_GLOBEE.need);
    expect(html).not.toContain(ASK_GLOBEE.historyLabel);
  });

  it("keeps the 7:73 landing header as spacer + avatar only", () => {
    navigation.search = "";
    const html = renderToStaticMarkup(<MessagesAppHeader surface="ask-globee-landing" />);
    expect(html).toBe("");
    expect(html).not.toContain("data-header-search");
    expect(html).not.toContain("data-header-thread");
    expect(html).not.toContain("data-ask-globee-download");
    expect(html).not.toContain(ASK_GLOBEE.downloadLabel);
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain(ASK_GLOBEE.threadTitle);
  });

  it("shows back + the conversation title on the unlocked thread, with no Search", () => {
    navigation.search = `thread=${THREAD}`;
    const html = visible(
      renderToStaticMarkup(
        <AskGlobeeChromeProvider
          initialChrome={{ id: THREAD, title: "What needs attention", pinned_at: null }}
        >
          <MessagesAppHeader surface="ask-globee-landing" />
        </AskGlobeeChromeProvider>,
      ),
    );
    expect(html).toContain("data-header-thread");
    expect(html).toContain("What needs attention");
    expect(html).toContain("data-ask-globee-history-title");
    expect(html).toContain(`href="/messages"`);
    expect(html).toContain(ASK_GLOBEE.backLabel);
    expect(html).toContain(ASK_GLOBEE.downloadLabel);
    expect(html).toContain("data-ask-globee-download");
    expect(html).toContain("data-ask-globee-header-chrome");
    expect(html).toContain(ASK_GLOBEE.moreLabel);
    expect(html).toContain("t-heading");
    expect(html).not.toContain("t-title");
    expect(src).toContain("Download");
    expect(src).toContain("saveAskGlobeeDownload");
    expect(src).toContain("strokeWidth={1.33}");
    expect(src).toContain("AskGlobeeHistoryPopover");
    expect(src).toContain("ChevronDown");
    expect(src).toContain("ChevronUp");
    expect(html).toContain('aria-expanded="false"');
    expect(src).toContain("historyOpen ? (");
    expect(src).toContain("<ChevronDown");
    expect(src).toContain("truncate t-heading text-ink");
    expect(src).toContain('className="flex min-w-0 items-center gap-[var(--space-4)]"');
    expect(src).toContain("data-ask-globee-header-chrome");
    expect(src).toContain("flex shrink-0 items-center gap-[var(--space-4)]");
    expect(src).toContain("<Download className=\"size-4\" strokeWidth={1.33} />");
    expect(src).toContain("<MoreHorizontal className=\"size-4\" strokeWidth={1.33} />");
    expect(src).not.toContain("truncate t-body-sm text-ink");
    expect(src).not.toContain("size-5");
    expect(src).not.toContain("size-6");
    expect(html).not.toContain("data-ask-globee-history-popover");
    expect(html).toContain(ASK_GLOBEE.deleteTitle);
    expect(html).toContain(ASK_GLOBEE.deleteBody);
    expect(html).toContain(ASK_GLOBEE.deleteConfirm);
    expect(html).toContain(ASK_GLOBEE.cancelLabel);
    expect(src).toContain("ASK_GLOBEE.renameLabel");
    expect(src).toContain("ASK_GLOBEE.pinLabel");
    expect(src).toContain("ASK_GLOBEE.deleteLabel");
    expect(src).not.toMatch(/Archive/);
    expect(html).not.toContain("data-header-search");
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain("SearchField");
    expect(html).not.toContain(ASK_GLOBEE.threadTitle);
    expect(html).not.toContain("Winter Line");
    if (src.includes("data-ask-globee-new")) {
      expect(html).toContain("data-ask-globee-new");
      expect(html).toContain(ASK_GLOBEE.newConversationLabel);
    }
  });

  it("sits the thread title on t-heading 17, not body 15 or 13", () => {
    const tokens = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/tokens.css"),
      "utf8",
    );
    const globals = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/globals.css"),
      "utf8",
    );

    expect(src).toContain("truncate t-heading text-ink");
    expect(src).not.toContain("truncate t-body-sm text-ink");
    expect(src).not.toContain("t-title");
    expect(src).not.toContain("t-body text-ink");
    expect(tokens).toMatch(/--text-lg:\s*1\.0625rem;/);
    expect(tokens).toMatch(/--text-base:\s*0\.9375rem;/);
    expect(tokens).toMatch(/--text-sm:\s*0\.8125rem;/);
    expect(tokens).toMatch(/--text-title:\s*1\.5rem;/);
    expect(globals).toMatch(/\.t-heading\s*\{[\s\S]*?font-size:\s*var\(--text-lg\)/);
    expect(globals).toMatch(/\.t-body\s*\{[\s\S]*?font-size:\s*var\(--text-base\)/);
    expect(globals).toMatch(/\.t-body-sm\s*\{[\s\S]*?font-size:\s*var\(--text-sm\)/);
    expect(globals).toMatch(/\.t-title\s*\{[\s\S]*?font-size:\s*var\(--text-title\)/);
  });

  it("renders nothing for the staff inbox", () => {
    navigation.search = `thread=${THREAD}`;
    const html = renderToStaticMarkup(<MessagesAppHeader surface="staff-inbox" />);
    expect(html).toBe("");
  });
});
