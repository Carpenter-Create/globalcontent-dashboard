import { describe, expect, it } from "vitest";

import { GC_NAV, NAV, clientNavCurrent, isClientNavActive } from "./nav";

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

  it("marks Dashboard current on `/` and Titles on a title path", () => {
    expect(clientNavCurrent("/").label).toBe("Dashboard");
    expect(isClientNavActive("/", NAV[0])).toBe(true);
    expect(isClientNavActive("/titles", NAV[0])).toBe(false);
    expect(clientNavCurrent("/titles").label).toBe("Titles");
    expect(clientNavCurrent("/titles/abc").label).toBe("Titles");
    expect(clientNavCurrent("/messages").label).toBe("Messages");
    expect(clientNavCurrent("/queue").label).toBe("Dashboard");
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

  it("keeps the full staff rail — client destinations then the operator set", () => {
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

  it("does not include the client deliveries path", () => {
    expect(GC_NAV.map((item) => item.href)).not.toContain("/deliveries");
  });
});
