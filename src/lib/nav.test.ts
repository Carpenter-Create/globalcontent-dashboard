import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Bot, MessageSquare, Sparkle, Sparkles } from "lucide-react";

import { ASK_GLOBEE } from "@/lib/ask-globee";
import {
  GC_NAV,
  NAV,
  clientNavCurrent,
  isClientNavActive,
  mobileNavDestinations,
} from "./nav";

const navSrc = readFileSync("src/lib/nav.ts", "utf8");

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
    expect(clientNavCurrent("/messages").label).toBe("Ask Globee");
    expect(clientNavCurrent("/messages").label).toBe(ASK_GLOBEE.headline);
    expect(clientNavCurrent("/queue").label).toBe("Dashboard");
  });

  it("keeps /messages as Ask Globee with Lucide Sparkles, not Messages or the bee", () => {
    const dest = NAV.find((item) => item.href === "/messages");
    expect(dest).toBeDefined();
    expect(dest?.label).toBe("Ask Globee");
    expect(dest?.href).toBe("/messages");
    expect(dest?.icon).toBe(Sparkles);
    expect(dest?.icon).not.toBe(Sparkle);
    expect(dest?.icon).not.toBe(MessageSquare);
    expect(dest?.icon).not.toBe(Bot);
    expect(NAV.map((item) => item.label)).not.toContain("Messages");
    expect(navSrc).toContain("icon: Sparkles");
    expect(navSrc).not.toContain("markSrc");
    expect(navSrc).not.toContain("ASK_GLOBEE_NAV_MARK");
    expect(navSrc).not.toContain("isNavImageItem");
    expect(navSrc).not.toContain("MessageSquare");
    expect(navSrc).not.toContain("NavImageItem");
  });
});

describe("Ask Globee nav mark", () => {
  it("drops the bee PNGs and the image mark path", () => {
    expect(() => readFileSync("public/ask-globee/ask-globee-16.png")).toThrow();
    expect(() => readFileSync("public/ask-globee/ask-globee-64.png")).toThrow();
    expect(() => readFileSync("src/components/chrome/nav-mark.tsx")).toThrow();
    expect(navSrc).not.toContain("ask-globee-16.png");
    expect(navSrc).not.toContain("ask-globee-64.png");
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
      "Ask Globee",
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

describe("mobileNavDestinations", () => {
  it("keeps the client sheet on the five NAV destinations", () => {
    expect(mobileNavDestinations(false).map((item) => item.label)).toEqual([
      "Dashboard",
      "Titles",
      "Deliveries",
      "Catalog Health",
      "Ask Globee",
    ]);
    expect(mobileNavDestinations(false).map((item) => item.href)).not.toContain("/queue");
    expect(mobileNavDestinations(false).map((item) => item.href)).not.toContain("/vendors");
    expect(mobileNavDestinations(false).map((item) => item.href)).not.toContain("/gc/clients");
  });

  it("gives staff the operator destinations plus the client five", () => {
    expect(mobileNavDestinations(true).map((item) => item.label)).toEqual([
      "Dashboard",
      "Titles",
      "Deliveries",
      "Catalog Health",
      "Ask Globee",
      "Queue",
      "GC Deliveries",
      "Vendors",
      "Clients",
    ]);
  });
});
