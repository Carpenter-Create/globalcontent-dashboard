import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/server";
import { UNPAGINATED_MAX } from "@/lib/list-bounds";
import { VENDOR_FORM_FIELD_LABELS, VENDORS_PAGE } from "@/lib/vendors-directory";
import { GC_NAV, NAV } from "@/lib/nav";

import GcVendorsPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const REAL_VENDOR = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Acme Distribution",
  delivery_mode: "email" as const,
  active: true,
};

function stubClient(rows: typeof REAL_VENDOR[] | null) {
  const vendorsChain = {
    select: vi.fn(() => vendorsChain),
    order: vi.fn(() => vendorsChain),
    range: vi.fn(async () => ({ data: rows, error: null })),
  };
  const from = vi.fn((table: string) => {
    if (table === "vendors") return vendorsChain;
    throw new Error(`unexpected from(${table})`);
  });
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { from, vendorsChain };
}

async function renderVendors(rows: typeof REAL_VENDOR[] | null = []) {
  stubClient(rows);
  return renderToStaticMarkup(await GcVendorsPage());
}

const pageSrc = readFileSync("src/app/(app)/(operator)/vendors/page.tsx", "utf8");

describe("staff /vendors address book", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders identity + empty copy and one Add vendor control", async () => {
    const html = await renderVendors([]);

    expect(html).toContain(VENDORS_PAGE.title);
    expect(html).toContain(VENDORS_PAGE.identity);
    expect(html).toContain(VENDORS_PAGE.emptyTitle);
    expect(html).toContain(VENDORS_PAGE.emptySupport);
    expect(html).toContain(VENDORS_PAGE.addVendor);
    expect(html).toContain(`href="${VENDORS_PAGE.addHref}"`);
    expect(html).toContain("data-vendors-empty");
    expect(html).toContain("data-vendors-add");
    expect(html).not.toContain("data-vendors-directory");
    expect(html.toLowerCase()).not.toContain("directory");
  });

  it("does not render VendorForm fields on the empty page", async () => {
    const html = await renderVendors([]);

    for (const label of VENDOR_FORM_FIELD_LABELS) {
      expect(html).not.toContain(label);
    }
    expect(html).not.toContain("Company info");
    expect(html).not.toContain("Export format spec");
    expect(html).not.toContain("Save vendor");
    expect(pageSrc).not.toContain("VendorForm");
    expect(pageSrc).not.toContain("New vendor");
  });

  it("uses the locked empty chrome: white r12 hairline, 48 circle, 24 storefront", async () => {
    const html = await renderVendors([]);

    expect(html).toContain("rounded-[12px]");
    expect(html).toContain("border-hairline");
    expect(html).toContain("bg-surface");
    expect(html).toContain("size-12");
    expect(html).toContain("size-6");
    expect(html).toContain("stroke-width=\"1.33\"");
    expect(html).toContain("bg-accent");
    expect(html).toContain("px-[var(--space-4)]");
    expect(html).not.toContain("border-dashed");
    expect(pageSrc).not.toContain("EmptyState");
    expect(pageSrc).toContain("PageHeader");
  });

  it("does not put Add vendor in the header", async () => {
    const html = await renderVendors([]);
    const headerEnd = html.indexOf("data-vendors-address-book");
    const header = html.slice(0, headerEnd);
    expect(header).toContain(VENDORS_PAGE.title);
    expect(header).toContain(VENDORS_PAGE.identity);
    expect(header).not.toContain(VENDORS_PAGE.addVendor);
    expect(header).not.toContain(VENDORS_PAGE.addHref);
  });

  it("turns the same surface into a directory of real vendors", async () => {
    const inactive = {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Northwind Partners",
      delivery_mode: "portal_upload" as const,
      active: false,
    };
    const html = await renderVendors([REAL_VENDOR, inactive]);

    expect(html).toContain("data-vendors-directory");
    expect(html).not.toContain("data-vendors-empty");
    expect(html).not.toContain("data-vendors-add");
    expect(html).toContain("Acme Distribution");
    expect(html).toContain("Northwind Partners");
    expect(html).toContain(`/vendors/${REAL_VENDOR.id}`);
    expect(html).toContain(`/vendors/${inactive.id}`);
    expect(html).toContain("Email");
    expect(html).toContain("Portal upload · inactive");
    expect(html).toContain(VENDORS_PAGE.identity);
    for (const label of VENDOR_FORM_FIELD_LABELS) {
      expect(html).not.toContain(label);
    }
  });

  it("does not invent fixture vendors in the page source", () => {
    expect(pageSrc).not.toMatch(/Netflix|Amazon|Hulu|Meridian|FIXTURE/i);
    expect(pageSrc).toContain("normalizeVendorDirectory");
    expect(pageSrc).not.toContain("VendorForm");
  });

  it("bounds the vendors read", async () => {
    const { from, vendorsChain } = stubClient([]);
    await GcVendorsPage();
    expect(from).toHaveBeenCalledWith("vendors");
    expect(vendorsChain.range).toHaveBeenCalled();
    expect(UNPAGINATED_MAX).toBeGreaterThan(0);
  });
});

describe("staff rail and neighboring locks", () => {
  it("keeps the full staff rail", () => {
    expect([...NAV, ...GC_NAV].map((item) => item.label)).toEqual([
      "Dashboard",
      "Titles",
      "Deliveries",
      "Catalog Health",
      "Messages",
      "Queue",
      "GC Deliveries",
      "Vendors",
      "Clients",
    ]);
  });

  it("does not restyle Ask Globee, client home, Access, /titles, or /deliveries", () => {
    const ask = readFileSync("src/components/messages/ask-globee-landing.tsx", "utf8");
    const deliveries = readFileSync("src/app/(app)/deliveries/page.tsx", "utf8");
    const titles = readFileSync("src/app/(app)/titles/page.tsx", "utf8");
    const nav = readFileSync("src/components/chrome/side-nav.tsx", "utf8");
    const home = readFileSync("src/app/(app)/page.tsx", "utf8");

    expect(ask).toContain("Figma 7:73 landing chrome");
    expect(ask).toContain("rounded-[28px]");
    expect(deliveries).toContain("EmptyState");
    expect(deliveries).toContain("Where your titles are placed and their status.");
    expect(titles).toContain("TITLES_CATALOG");
    expect(nav).toContain("Access rail");
    expect(home).toContain("GcClientsDirectory");
    expect(pageSrc).not.toContain("ask-globee");
    expect(pageSrc).not.toContain("TITLES_CATALOG");
    expect(readFileSync("src/app/(app)/(operator)/vendors/new/page.tsx", "utf8")).toContain(
      "VendorForm",
    );
  });
});
