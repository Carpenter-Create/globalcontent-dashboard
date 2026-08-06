import { describe, expect, it } from "vitest";
import { isMasterLicensed, ACTIVE_DELIVERY_STATUSES_LIST, type DeliveryForLicenceCheck } from "@/lib/master-licence";

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

  it("licenses a pending delivery — delivery is manual and the download IS the handover, matching portal_resolve_download's own allow-list", () => {
    expect(isMasterLicensed([active({ status: "pending" })], now)).toBe(true);
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

  it("fails closed on a missing territory even under an exclude-mode grant (would otherwise wrongly allow)", () => {
    const grant = { ...worldGrant, territory_mode: "exclude", territories: ["FR"] };
    // `!territories.includes(undefined)` is `true` — the exact wrong-direction bug this guard
    // exists to prevent. territory is NOT NULL in the schema; this proves the defensive path.
    expect(isMasterLicensed([active({ territory: "" as unknown as string, grant })], now)).toBe(false);
  });

  it("licenses if ANY of several delivery rows qualifies", () => {
    const rows = [
      active({ status: "rejected" }),
      active({ status: "taken_down" }),
      active({ status: "live" }),
    ];
    expect(isMasterLicensed(rows, now)).toBe(true);
  });
});

// Fix round 3, item 6: this predicate is duplicated a THIRD time in SQL (title_vendor_licensed,
// 20260806000400_attach_link_vendor.sql) on top of portal_resolve_download
// (20260720000100_portal_gate.sql) — and it already drifted once on 'pending'. Pinning the
// exact list here, by value, means a future one-sided edit to this array fails a test
// immediately instead of silently disagreeing with the two SQL copies. The SQL side is pinned
// separately by supabase/tests/master_licence_status_parity_test.sql (pgTAP), which asserts
// portal_resolve_download and title_vendor_licensed agree with each other across every
// delivery_status value — this test and that one are the two halves of "assert it identically
// in both languages."
describe("ACTIVE_DELIVERY_STATUSES_LIST", () => {
  it("is exactly pending/delivered/live, matching both SQL copies of this predicate", () => {
    expect([...ACTIVE_DELIVERY_STATUSES_LIST].sort()).toEqual(["delivered", "live", "pending"]);
  });
});
