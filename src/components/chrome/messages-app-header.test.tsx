import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { MessagesAppHeader } from "./messages-app-header";

function visible(html: string): string {
  return html.replaceAll("&#x27;", "'");
}

describe("MessagesAppHeader", () => {
  it("restores Search only on the Access gate, even with a thread query", () => {
    navigation.search = "q=What+needs+attention";
    const html = renderToStaticMarkup(<MessagesAppHeader surface="access-gate" />);
    expect(html).toContain("data-header-search");
    expect(html).toContain(ASK_GLOBEE.headerSearchPlaceholder);
    expect(html).toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain("data-header-thread");
    expect(html).not.toContain("What needs attention");
    expect(html).not.toContain(ASK_GLOBEE.threadTitle);
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

  it("shows back + the caller's prompt on the unlocked thread, with no Search", () => {
    navigation.search = "q=What+needs+attention";
    const html = visible(renderToStaticMarkup(<MessagesAppHeader surface="ask-globee-landing" />));
    expect(html).toContain("data-header-thread");
    expect(html).toContain("What needs attention");
    expect(html).toContain(`href="/messages"`);
    expect(html).toContain(ASK_GLOBEE.backLabel);
    expect(html).not.toContain("data-header-search");
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain("SearchField");
    expect(html).not.toContain(ASK_GLOBEE.threadTitle);
    expect(html).not.toContain("Winter Line");
  });

  it("renders nothing for the staff inbox", () => {
    navigation.search = "q=What+needs+attention";
    const html = renderToStaticMarkup(<MessagesAppHeader surface="staff-inbox" />);
    expect(html).toBe("");
  });
});
