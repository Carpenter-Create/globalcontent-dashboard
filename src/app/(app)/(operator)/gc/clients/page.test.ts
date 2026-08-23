import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { CLIENTS_PAGE } from "@/lib/clients";
import { UNPAGINATED_MAX } from "@/lib/list-bounds";

import GcClientsPage from "./page";

/**
 * The bound has to be a PROBE, not the page size: asking for exactly UNPAGINATED_MAX rows
 * returns a truncated list that looks complete, which is the failure list-bounds.ts exists
 * to prevent. This asserts the page asks for one more than it shows.
 */
describe("GcClientsPage read bound", () => {
  beforeEach(() => vi.clearAllMocks());

  it("probes one row past the cap so truncation can be detected", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);

    await GcClientsPage();

    expect(rpc).toHaveBeenCalledWith("gc_client_directory", { p_limit: UNPAGINATED_MAX + 1 });
  });

  it("renders without a client org present", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);

    await expect(GcClientsPage()).resolves.toBeTruthy();
  });

  it("renders No clients yet. with no Add or CTA", async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);

    const html = renderToStaticMarkup(await GcClientsPage());
    const emptyStart = html.indexOf(CLIENTS_PAGE.empty);
    const cardStart = html.lastIndexOf("<div", emptyStart);
    const cardEnd = html.indexOf("</div></div>", emptyStart);
    const card = html.slice(cardStart, cardEnd);

    expect(html).toContain(CLIENTS_PAGE.title);
    expect(html).toContain(CLIENTS_PAGE.empty);
    expect(html).not.toContain("No client organizations yet.");
    expect(html).not.toContain("Add");
    expect(html).not.toContain("View titles");
    expect(card).toContain(CLIENTS_PAGE.empty);
    expect(card).not.toContain("<a");
    expect(card).not.toContain("bg-accent");
    expect(card).not.toContain("text-accent");
  });
});
