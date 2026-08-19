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
  setAskGlobeeThumb: vi.fn(),
  renameAskGlobeeConversation: vi.fn(),
  pinAskGlobeeConversation: vi.fn(),
  deleteAskGlobeeConversation: vi.fn(),
}));

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { AskGlobeeChromeProvider } from "@/components/messages/ask-globee-chrome";
import { MessagesAppHeader } from "./messages-app-header";

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
    expect(html).toContain(`href="/messages"`);
    expect(html).toContain(ASK_GLOBEE.backLabel);
    expect(html).toContain(ASK_GLOBEE.moreLabel);
    expect(html).toContain(ASK_GLOBEE.renameLabel);
    expect(html).toContain(ASK_GLOBEE.pinLabel);
    expect(html).toContain(ASK_GLOBEE.deleteLabel);
    expect(html).toContain(ASK_GLOBEE.deleteTitle);
    expect(html).toContain(ASK_GLOBEE.deleteBody);
    expect(html).not.toMatch(/Archive/i);
    expect(html).not.toContain("data-header-search");
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain("SearchField");
    expect(html).not.toContain(ASK_GLOBEE.threadTitle);
    expect(html).not.toContain("Winter Line");
  });

  it("renders nothing for the staff inbox", () => {
    navigation.search = `thread=${THREAD}`;
    const html = renderToStaticMarkup(<MessagesAppHeader surface="staff-inbox" />);
    expect(html).toBe("");
  });
});
