import { describe, expect, it } from "vitest";
import { isMasterLicensed, type DeliveryForLicenceCheck } from "@/lib/master-licence";

const now = new Date("2026-08-06T12:00:00Z");

const worldGrant: DeliveryForLicenceCheck["grant"] = {
  effective_to: null,
  window_start: null,
  window_end: null,
  territory_mode: "world",
  territories: [],
};

const active = (overrides: Partial<DeliveryForLicenceCheck> = {}): DeliveryForLicenceCheck => ({
  status: "delivered",
  territory: "US",
  grant: worldGrant,
  ...overrides,
});

describe("isMasterLicensed", () => {
  it("refuses with no deliveries at all", () => {
    expect(isMasterLicensed([], now)).toBe(false);
  });

  it("licenses a delivered placement under a world grant", () => {
    expect(isMasterLicensed([active({ status: "delivered" })], now)).toBe(true);
  });

  it("licenses a live placement", () => {
    expect(isMasterLicensed([active({ status: "live" })], now)).toBe(true);
  });

  it("refuses a pending delivery — not yet actually out", () => {
    expect(isMasterLicensed([active({ status: "pending" })], now)).toBe(false);
  });

  it("refuses a rejected delivery", () => {
    expect(isMasterLicensed([active({ status: "rejected" })], now)).toBe(false);
  });

  it("refuses a taken_down delivery", () => {
    expect(isMasterLicensed([active({ status: "taken_down" })], now)).toBe(false);
  });

  it("refuses when no grant is joined at all", () => {
    expect(isMasterLicensed([active({ grant: null })], now)).toBe(false);
  });

  it("refuses a grant that has naturally expired (effective_to set)", () => {
    expect(
      isMasterLicensed([active({ grant: { ...worldGrant, effective_to: "2026-01-01T00:00:00Z" } })], now),
    ).toBe(false);
  });

  it("refuses before the grant's window has started", () => {
    expect(
      isMasterLicensed([active({ grant: { ...worldGrant, window_start: "2027-01-01T00:00:00Z" } })], now),
    ).toBe(false);
  });

  it("refuses after the grant's window has ended", () => {
    expect(
      isMasterLicensed([active({ grant: { ...worldGrant, window_end: "2025-01-01T00:00:00Z" } })], now),
    ).toBe(false);
  });

  it("licenses an include-mode grant covering the delivery's territory", () => {
    const grant = { ...worldGrant, territory_mode: "include", territories: ["US", "CA"] };
    expect(isMasterLicensed([active({ territory: "US", grant })], now)).toBe(true);
  });

  it("refuses an include-mode grant that does not cover the delivery's territory", () => {
    const grant = { ...worldGrant, territory_mode: "include", territories: ["CA"] };
    expect(isMasterLicensed([active({ territory: "US", grant })], now)).toBe(false);
  });

  it("licenses an exclude-mode grant when the territory is not in the exclusion list", () => {
    const grant = { ...worldGrant, territory_mode: "exclude", territories: ["FR"] };
    expect(isMasterLicensed([active({ territory: "US", grant })], now)).toBe(true);
  });

  it("refuses an exclude-mode grant when the territory IS in the exclusion list", () => {
    const grant = { ...worldGrant, territory_mode: "exclude", territories: ["US"] };
    expect(isMasterLicensed([active({ territory: "US", grant })], now)).toBe(false);
  });

  it("fails closed on an unknown territory_mode", () => {
    const grant = { ...worldGrant, territory_mode: "some_future_mode" };
    expect(isMasterLicensed([active({ grant })], now)).toBe(false);
  });

  it("licenses if ANY of several delivery rows qualifies", () => {
    const rows = [
      active({ status: "rejected" }),
      active({ status: "pending" }),
      active({ status: "live" }),
    ];
    expect(isMasterLicensed(rows, now)).toBe(true);
  });

  it("this link's vendor scoping is the caller's job — this function only judges the rows it is handed", () => {
    // Regression guard for the exact failure this gate exists to prevent: the caller must
    // filter deliveries to (title, vendor_id) BEFORE calling this. An empty array (as if no
    // delivery existed for this vendor) must never license.
    expect(isMasterLicensed([], now)).toBe(false);
  });
});
