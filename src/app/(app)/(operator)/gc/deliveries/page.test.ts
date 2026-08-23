import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/server";
import { GC_DELIVERIES_EMPTY } from "@/lib/gc-deliveries";
import GcDeliveriesPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./new-delivery-form", () => ({ NewDeliveryForm: () => null }));
vi.mock("./export-panel", () => ({ ExportPanel: () => null }));
vi.mock("./delivery-controls", () => ({ DeliveryControls: () => null }));
vi.mock("./portal-links", () => ({ PortalLinks: () => null }));

function stubEmptyClient() {
  const chain: {
    select: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    range: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    then: (resolve: (value: { data: never[]; error: null }) => unknown) => unknown;
  } = {
    select: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range: vi.fn(() => chain),
    in: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    then: (resolve) => resolve({ data: [], error: null }),
  };
  const from = vi.fn(() => chain);
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { from, chain };
}

async function renderEmptyDeliveries() {
  stubEmptyClient();
  return renderToStaticMarkup(await GcDeliveriesPage());
}

const pageSrc = readFileSync("src/app/(app)/(operator)/gc/deliveries/page.tsx", "utf8");
const viewTitlesClass = "t-body-sm text-accent transition-colors hover:underline";

describe("staff /gc/deliveries empty copy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the Deliveries title and locked empty line", async () => {
    const html = await renderEmptyDeliveries();

    expect(html).toContain(">Deliveries<");
    expect(GC_DELIVERIES_EMPTY.title).toBe("No deliveries yet.");
    expect(html).toContain("No deliveries yet.");
  });

  it("renders View titles as Sporty Blue text, not a filled button", async () => {
    const html = await renderEmptyDeliveries();
    const marker = html.indexOf("View titles");
    const addStart = html.lastIndexOf("<a", marker);
    const addEnd = html.indexOf("</a>", marker);
    const link = html.slice(addStart, addEnd);

    expect(GC_DELIVERIES_EMPTY.actionLabel).toBe("View titles");
    expect(GC_DELIVERIES_EMPTY.actionHref).toBe("/titles");
    expect(html).toContain('href="/titles"');
    expect(html).toContain("View titles");
    expect(pageSrc).toContain(viewTitlesClass);
    expect(link).toContain("t-body-sm");
    expect(link).toContain("text-accent");
    expect(link).toContain("hover:underline");
    expect(link).toContain("View titles");
    expect(link).not.toContain("bg-accent");
    expect(link).not.toContain("text-accent-contrast");
    expect(link).not.toContain("rounded-[12px]");
    expect(link).not.toContain("px-[var(--space-4)]");
    expect(link).not.toContain("py-[var(--space-2)]");
    expect(link).not.toContain("inline-flex");
  });

  it("does not restyle client /deliveries or vendors", () => {
    const clientDeliveries = readFileSync("src/app/(app)/deliveries/page.tsx", "utf8");
    const vendors = readFileSync("src/app/(app)/(operator)/vendors/page.tsx", "utf8");

    expect(clientDeliveries).toContain("EmptyState");
    expect(clientDeliveries).toContain("Where your titles are placed and their status.");
    expect(vendors).toContain("VENDORS_PAGE");
    expect(pageSrc).not.toContain("EmptyState");
    expect(pageSrc).not.toContain("VENDORS_PAGE");
  });
});
