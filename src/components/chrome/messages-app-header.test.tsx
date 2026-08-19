import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(),
}));

import { ASK_GLOBEE } from "@/lib/ask-globee";
import { MessagesAppHeader } from "./messages-app-header";

function visible(html: string): string {
  return html.replaceAll("&#x27;", "'");
}

describe("MessagesAppHeader", () => {
  it("restores Search only on the Access gate", () => {
    const html = renderToStaticMarkup(<MessagesAppHeader surface="access-gate" />);
    expect(html).toContain("data-header-search");
    expect(html).toContain(ASK_GLOBEE.headerSearchPlaceholder);
    expect(html).toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain("data-header-thread");
    expect(html).not.toContain(ASK_GLOBEE.threadTitle);
  });

  it("shows the 247:295 back + title header with no Search", () => {
    const html = visible(renderToStaticMarkup(<MessagesAppHeader surface="ask-globee-thread" />));
    expect(html).toContain("data-header-thread");
    expect(html).toContain(ASK_GLOBEE.threadTitle);
    expect(html).not.toContain("data-header-search");
    expect(html).not.toContain(ASK_GLOBEE.headerSearchHint);
    expect(html).not.toContain("SearchField");
  });

  it("renders nothing for the staff inbox", () => {
    const html = renderToStaticMarkup(<MessagesAppHeader surface="staff-inbox" />);
    expect(html).toBe("");
  });
});
