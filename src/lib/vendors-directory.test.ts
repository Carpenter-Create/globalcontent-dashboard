import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  VENDOR_FORM_FIELD_LABELS,
  VENDORS_PAGE,
  asVendorDirectoryRow,
  normalizeVendorDirectory,
  vendorDirectoryHref,
  vendorDirectoryMeta,
} from "./vendors-directory";

describe("VENDORS_PAGE lock copy", () => {
  it("keeps the identity line and empty address-book copy", () => {
    expect(VENDORS_PAGE.title).toBe("Vendors");
    expect(VENDORS_PAGE.identity).toBe("Credentials are never stored here.");
    expect(VENDORS_PAGE.emptyTitle).toBe("No vendors yet");
    expect(VENDORS_PAGE).not.toHaveProperty("emptySupport");
    expect(VENDORS_PAGE.addVendor).toBe("Add vendor");
    expect(VENDORS_PAGE.addHref).toBe("/vendors/new");
    expect(JSON.stringify(VENDORS_PAGE)).not.toContain("GC distribution partners.");
    expect(JSON.stringify(VENDORS_PAGE)).not.toContain("Add your first partner.");
  });

  it("lists the form fields that must not appear on the empty page", () => {
    expect(VENDOR_FORM_FIELD_LABELS).toEqual([
      "Name",
      "Delivery mode",
      "Email recipients (comma-separated)",
      "Email CC (comma-separated)",
      "Email template",
      "Company info (JSON, optional)",
      "Export format spec (JSON, optional)",
      "Active",
      "Save vendor",
      "New vendor",
    ]);
  });
});

describe("vendor directory rows", () => {
  const real = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Acme Distribution",
    delivery_mode: "portal_upload",
    active: true,
  };

  it("accepts a real DB-shaped row and rejects junk", () => {
    expect(asVendorDirectoryRow(real)).toEqual({
      id: real.id,
      name: real.name,
      deliveryMode: "portal_upload",
      active: true,
    });
    expect(asVendorDirectoryRow(null)).toBeNull();
    expect(asVendorDirectoryRow({ ...real, name: "" })).toBeNull();
    expect(asVendorDirectoryRow({ ...real, delivery_mode: "ftp" })).toBeNull();
  });

  it("normalizes only real rows — no invented fixtures", () => {
    expect(normalizeVendorDirectory(null)).toEqual([]);
    expect(normalizeVendorDirectory([real, { id: "x" }])).toEqual([
      {
        id: real.id,
        name: real.name,
        deliveryMode: "portal_upload",
        active: true,
      },
    ]);
  });

  it("builds the edit href and directory meta from the row", () => {
    const row = asVendorDirectoryRow(real);
    if (!row) throw new Error("expected row");
    expect(vendorDirectoryHref(row)).toBe(`/vendors/${real.id}`);
    expect(vendorDirectoryMeta(row)).toBe("Portal upload");
    expect(
      vendorDirectoryMeta({
        ...row,
        deliveryMode: "email",
        active: false,
      }),
    ).toBe("Email · inactive");
  });
});

describe("shared EmptyState primitive stays the dashed 40-circle layout", () => {
  it("does not pick up the vendors 48/24 hairline lock", () => {
    const src = readFileSync("src/components/layout/empty-state.tsx", "utf8");
    expect(src).toContain("border-dashed");
    expect(src).toContain("h-10 w-10");
    expect(src).toContain("h-5 w-5");
    expect(src).not.toContain("size-12");
    expect(src).not.toContain("size-6");
  });
});
