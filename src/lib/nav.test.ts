import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ASK_GLOBEE } from "@/lib/ask-globee";
import {
  ASK_GLOBEE_NAV_MARK,
  GC_NAV,
  NAV,
  clientNavCurrent,
  isClientNavActive,
  isNavImageItem,
  mobileNavDestinations,
} from "./nav";

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

  it("keeps /messages as Ask Globee with the 16 bee mark, not Messages or Lucide", () => {
    const dest = NAV.find((item) => item.href === "/messages");
    expect(dest).toBeDefined();
    expect(dest?.label).toBe("Ask Globee");
    expect(dest?.href).toBe("/messages");
    expect(isNavImageItem(dest!)).toBe(true);
    expect(dest?.markSrc).toBe(ASK_GLOBEE_NAV_MARK.displaySrc);
    expect(dest?.markSrc).toBe(ASK_GLOBEE_NAV_MARK.src16);
    expect(dest?.markSrc).not.toBe(ASK_GLOBEE_NAV_MARK.src64);
    expect(dest?.icon).toBeUndefined();
    expect(NAV.map((item) => item.label)).not.toContain("Messages");
  });
});

describe("Ask Globee Grok PNGs", () => {
  it("stores Bee/16 18:3 and Bee/64 18:2 and displays the cropped 16 in size-4", () => {
    const files = {
      16: "public/ask-globee/ask-globee-16.png",
      64: "public/ask-globee/ask-globee-64.png",
    } as const;
    const hashes = {
      16: "408fa5f5fc07e30b68e31fed91b4ce26e53e6b890069ca03fd36a96398e3b4df",
      64: "0c10c8455b297644472fd43b542f77af499d7decb98579537b239ea824a65082",
    } as const;
    for (const [size, path] of Object.entries(files)) {
      const bytes = readFileSync(path);
      expect(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
        true,
      );
      expect(bytes.includes(Buffer.from("Software\0Figma"))).toBe(true);
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      expect(width).toBe(Number(size));
      expect(height).toBe(Number(size));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(hashes[Number(size) as 16 | 64]);
    }
    expect(ASK_GLOBEE_NAV_MARK.displaySrc).toBe("/ask-globee/ask-globee-16.png");
    expect(ASK_GLOBEE_NAV_MARK.displaySrc).toBe(ASK_GLOBEE_NAV_MARK.src16);
    expect(ASK_GLOBEE_NAV_MARK.lock).toBe("408fa5f5");
    expect(ASK_GLOBEE_NAV_MARK.fillClass).toBe("size-4");
    expect(ASK_GLOBEE_NAV_MARK.fillClass).not.toContain("size-6");
    expect(() => readFileSync("public/ask-globee/ask-globee-24.png")).toThrow();
    expect(() => readFileSync("public/ask-globee/ask-globee-32.png")).toThrow();
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
