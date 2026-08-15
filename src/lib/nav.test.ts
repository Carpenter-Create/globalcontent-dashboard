import { describe, expect, it } from "vitest";

import { GC_NAV, NAV } from "./nav";

describe("client NAV", () => {
  it("keeps Dashboard at / and never exposes operator routes", () => {
    const hrefs = NAV.map((item) => item.href);
    expect(hrefs[0]).toBe("/");
    expect(hrefs).toContain("/deliveries");
    expect(hrefs).not.toContain("/gc/deliveries");
    expect(hrefs).not.toContain("/queue");
    expect(hrefs).not.toContain("/vendors");
    expect(hrefs).not.toContain("/gc/clients");
  });
});

describe("GC_NAV", () => {
  it("adds staff-only GC Deliveries between Queue and Vendors, with Clients last", () => {
    expect(GC_NAV.map((item) => ({ label: item.label, href: item.href }))).toEqual([
      { label: "Queue", href: "/queue" },
      { label: "GC Deliveries", href: "/gc/deliveries" },
      { label: "Vendors", href: "/vendors" },
      { label: "Clients", href: "/gc/clients" },
    ]);
  });

  it("does not include the client deliveries path", () => {
    expect(GC_NAV.map((item) => item.href)).not.toContain("/deliveries");
  });
});
