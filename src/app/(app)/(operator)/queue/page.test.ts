import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/server";
import { LIST_PAGE } from "@/lib/list-bounds";
import { QUEUE_PAGE } from "@/lib/queue";
import GcQueuePage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

function stubClient() {
  const titlesChain = {
    select: vi.fn(() => titlesChain),
    in: vi.fn(() => titlesChain),
    order: vi.fn(() => titlesChain),
    range: vi.fn(async () => ({ data: [], error: null })),
  };
  const from = vi.fn((table: string) => {
    if (table === "titles") return titlesChain;
    throw new Error(`unexpected from(${table})`);
  });
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { from, titlesChain };
}

/**
 * Queue remains the focused work queue at /queue. Staff home moving to `/` must
 * not absorb or remove this surface.
 */
describe("GcQueuePage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("still renders the focused work queue at /queue", async () => {
    const { from, titlesChain } = stubClient();

    const html = renderToStaticMarkup(await GcQueuePage());

    expect(from).toHaveBeenCalledWith("titles");
    expect(titlesChain.in).toHaveBeenCalledWith("status", ["in_review", "in_delivery"]);
    expect(html).toContain("Queue");
    expect(html).toContain("Titles that need your attention, across all clients.");
    expect(html).toContain("Needs review");
    expect(html).toContain("Ready to deliver");
    expect(html).toContain("/gc/deliveries");
  });

  it("bounds the cross-org title read", async () => {
    const { titlesChain } = stubClient();
    await GcQueuePage();
    expect(titlesChain.range).toHaveBeenCalled();
    expect(LIST_PAGE).toBeGreaterThan(0);
  });

  it("renders Nothing waiting. with no Add or empty CTA", async () => {
    stubClient();
    const html = renderToStaticMarkup(await GcQueuePage());

    expect(QUEUE_PAGE.empty).toBe("Nothing waiting.");
    expect(html).toContain(QUEUE_PAGE.empty);
    expect(html).not.toContain("Nothing awaiting review.");
    expect(html).not.toContain("Nothing ready to deliver.");
    expect(html).not.toContain("Add");
    expect(html).not.toContain("View titles");

    let from = 0;
    let emptyCards = 0;
    while (from < html.length) {
      const marker = html.indexOf(QUEUE_PAGE.empty, from);
      if (marker < 0) break;
      const cardStart = html.lastIndexOf("<div", marker);
      const cardEnd = html.indexOf("</div></div>", marker);
      const card = html.slice(cardStart, cardEnd);
      expect(card).toContain(QUEUE_PAGE.empty);
      expect(card).not.toContain("<a");
      expect(card).not.toContain("bg-accent");
      emptyCards += 1;
      from = marker + QUEUE_PAGE.empty.length;
    }
    expect(emptyCards).toBe(2);
  });
});
