import { describe, expect, it } from "vitest";

import {
  asDeliveryBrowseRow,
  buildDeliveriesQuery,
  DEFAULT_DELIVERY_SORT,
  DELIVERIES_FILTER_MISS,
  DELIVERIES_NO_DATA,
  deliveriesShowAllHref,
  deliveriesSortHref,
  deliveriesStatusHref,
  deliveryStatusDisplay,
  deliveryStatusTone,
  deliveryTitleHref,
  deliveryUpdatedAtMs,
  filterDeliveries,
  normalizeMyDeliveries,
  parseDeliverySort,
  parseDeliveryStatusFilter,
  sortDeliveries,
  type DeliveryBrowseRow,
} from "./deliveries-browse";

const ID = {
  b: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  a: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  c: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  d: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  t1: "11111111-1111-4111-8111-111111111111",
  t2: "22222222-2222-4222-8222-222222222222",
  t3: "33333333-3333-4333-8333-333333333333",
  t4: "44444444-4444-4444-8444-444444444444",
} as const;

const rows: DeliveryBrowseRow[] = [
  {
    delivery_id: ID.b,
    title_id: ID.t1,
    title: "Beta",
    vendor_name: "Zulu",
    territory: "US",
    status: "pending",
    updated_at: "2026-03-01T12:00:00.000Z",
  },
  {
    delivery_id: ID.a,
    title_id: ID.t2,
    title: "Alpha",
    vendor_name: "Acme",
    territory: "CA",
    status: "live",
    updated_at: "2026-01-01T12:00:00.000Z",
  },
  {
    delivery_id: ID.c,
    title_id: ID.t3,
    title: "Gamma",
    vendor_name: "Mid",
    territory: "GB",
    status: "rejected",
    updated_at: null,
  },
  {
    delivery_id: ID.d,
    title_id: ID.t4,
    title: "Delta",
    vendor_name: "Mid",
    territory: "AU",
    status: "live",
    updated_at: "not-a-date",
  },
];

const validRaw = {
  delivery_id: ID.a,
  title_id: ID.t2,
  title: "Alpha",
  vendor_name: "Acme",
  territory: "CA",
  status: "live",
  updated_at: "2026-01-01T12:00:00.000Z",
};

describe("parseDeliveryStatusFilter", () => {
  it("accepts each allowlisted status including all", () => {
    expect(parseDeliveryStatusFilter("all")).toBe("all");
    expect(parseDeliveryStatusFilter("pending")).toBe("pending");
    expect(parseDeliveryStatusFilter("delivered")).toBe("delivered");
    expect(parseDeliveryStatusFilter("live")).toBe("live");
    expect(parseDeliveryStatusFilter("rejected")).toBe("rejected");
    expect(parseDeliveryStatusFilter("taken_down")).toBe("taken_down");
  });

  it("falls back to all for missing, empty, unknown, or array-shaped input", () => {
    expect(parseDeliveryStatusFilter(undefined)).toBe("all");
    expect(parseDeliveryStatusFilter("")).toBe("all");
    expect(parseDeliveryStatusFilter("bogus")).toBe("all");
    expect(parseDeliveryStatusFilter(["live"])).toBe("all");
    expect(parseDeliveryStatusFilter(["live", "pending"])).toBe("all");
  });
});

describe("asDeliveryBrowseRow / normalizeMyDeliveries", () => {
  it("accepts a well-formed row and lowercases UUIDs", () => {
    const parsed = asDeliveryBrowseRow({
      ...validRaw,
      delivery_id: ID.a.toUpperCase(),
      title_id: ID.t2.toUpperCase(),
    });
    expect(parsed).toEqual({
      ...validRaw,
      delivery_id: ID.a,
      title_id: ID.t2,
    });
  });

  it("rejects malformed delivery_id", () => {
    expect(asDeliveryBrowseRow({ ...validRaw, delivery_id: "not-a-uuid" })).toBeNull();
    expect(asDeliveryBrowseRow({ ...validRaw, delivery_id: "" })).toBeNull();
    expect(asDeliveryBrowseRow({ ...validRaw, delivery_id: 12 })).toBeNull();
    expect(asDeliveryBrowseRow({ ...validRaw, delivery_id: null })).toBeNull();
  });

  it("rejects malformed title_id", () => {
    expect(asDeliveryBrowseRow({ ...validRaw, title_id: "t2" })).toBeNull();
    expect(asDeliveryBrowseRow({ ...validRaw, title_id: null })).toBeNull();
    expect(asDeliveryBrowseRow({ ...validRaw, title_id: ["x"] })).toBeNull();
  });

  it("rejects unknown, missing, null, and status-like status values", () => {
    expect(asDeliveryBrowseRow({ ...validRaw, status: "all" })).toBeNull();
    expect(asDeliveryBrowseRow({ ...validRaw, status: "Live" })).toBeNull();
    expect(asDeliveryBrowseRow({ ...validRaw, status: "pending_review" })).toBeNull();
    expect(asDeliveryBrowseRow({ ...validRaw, status: null })).toBeNull();
    expect(asDeliveryBrowseRow({ ...validRaw, status: undefined })).toBeNull();
    expect(
      asDeliveryBrowseRow({
        delivery_id: validRaw.delivery_id,
        title_id: validRaw.title_id,
        title: validRaw.title,
        vendor_name: validRaw.vendor_name,
        territory: validRaw.territory,
        updated_at: validRaw.updated_at,
      }),
    ).toBeNull();
  });

  it("keeps only valid rows from a mixed RPC payload", () => {
    const mixed = [
      validRaw,
      { ...validRaw, delivery_id: "bad" },
      { ...validRaw, title_id: "also-bad", delivery_id: ID.b },
      { ...validRaw, status: "nope", delivery_id: ID.c, title_id: ID.t3 },
      null,
      "string-row",
      {
        delivery_id: ID.d,
        title_id: ID.t4,
        title: "Delta",
        vendor_name: "Mid",
        territory: "AU",
        status: "delivered",
        updated_at: null,
      },
    ];
    const out = normalizeMyDeliveries(mixed);
    expect(out.map((r) => r.delivery_id)).toEqual([ID.a, ID.d]);
    expect(out.every((r) => r.status === "live" || r.status === "delivered")).toBe(true);
  });

  it("does not produce title destinations from invalid rows", () => {
    const invalid = [
      { ...validRaw, delivery_id: "x" },
      { ...validRaw, title_id: "y" },
      { ...validRaw, status: "all" },
    ];
    const normalized = normalizeMyDeliveries(invalid);
    expect(normalized).toEqual([]);
    for (const row of invalid) {
      expect(asDeliveryBrowseRow(row)).toBeNull();
    }
  });

  it("returns [] for non-array RPC payloads", () => {
    expect(normalizeMyDeliveries(null)).toEqual([]);
    expect(normalizeMyDeliveries({ rows: [validRaw] })).toEqual([]);
  });
});

describe("page-view helpers (consumed by /deliveries)", () => {
  it("builds the exact title destination for a validated row", () => {
    expect(deliveryTitleHref(rows[1])).toBe(`/titles/${ID.t2}`);
  });

  it("exposes the approved no-data empty-state copy and /titles action", () => {
    expect(DELIVERIES_NO_DATA).toEqual({
      title: "No deliveries yet",
      description: "Placements appear here once a title is delivered to a platform.",
      actionLabel: "View titles",
      actionHref: "/titles",
    });
  });

  it("exposes filter-miss copy and Show all URL that clears status while preserving sort", () => {
    expect(DELIVERIES_FILTER_MISS.title).toBe("No deliveries match this status");
    expect(DELIVERIES_FILTER_MISS.description).toBe("Try another status, or clear the filter.");
    expect(DELIVERIES_FILTER_MISS.actionLabel).toBe("Show all");
    expect(deliveriesShowAllHref("live", { key: "title", dir: "asc" })).toBe(
      "/deliveries?sort=title&dir=asc",
    );
    expect(deliveriesShowAllHref("pending", DEFAULT_DELIVERY_SORT)).toBe("/deliveries");
  });

  it("maps valid statuses to approved labels and tones", () => {
    expect(deliveryStatusDisplay("pending")).toEqual({ label: "Pending", tone: "neutral" });
    expect(deliveryStatusDisplay("delivered")).toEqual({ label: "Delivered", tone: "neutral" });
    expect(deliveryStatusDisplay("live")).toEqual({ label: "Live", tone: "active" });
    expect(deliveryStatusDisplay("rejected")).toEqual({ label: "Rejected", tone: "muted" });
    expect(deliveryStatusDisplay("taken_down")).toEqual({ label: "Taken down", tone: "muted" });
  });
});

describe("filterDeliveries", () => {
  it("returns a shallow copy for all", () => {
    const out = filterDeliveries(rows, "all");
    expect(out).toEqual(rows);
    expect(out).not.toBe(rows);
  });

  it("filters by status", () => {
    expect(filterDeliveries(rows, "live").map((r) => r.delivery_id)).toEqual([ID.a, ID.d]);
    expect(filterDeliveries(rows, "pending").map((r) => r.delivery_id)).toEqual([ID.b]);
    expect(filterDeliveries([], "live")).toEqual([]);
  });
});

describe("parseDeliverySort", () => {
  it("defaults to updated desc", () => {
    expect(parseDeliverySort(undefined, undefined)).toEqual(DEFAULT_DELIVERY_SORT);
  });

  it("accepts allowlisted key + dir", () => {
    expect(parseDeliverySort("title", "asc")).toEqual({ key: "title", dir: "asc" });
    expect(parseDeliverySort("vendor", "desc")).toEqual({ key: "vendor", dir: "desc" });
  });

  it("falls back for invalid key, dir, or array-shaped input", () => {
    expect(parseDeliverySort("evil", "asc")).toEqual({ key: "updated", dir: "asc" });
    expect(parseDeliverySort("title", "sideways")).toEqual({ key: "title", dir: "desc" });
    expect(parseDeliverySort(["updated"], "desc")).toEqual(DEFAULT_DELIVERY_SORT);
    expect(parseDeliverySort("updated", ["desc"])).toEqual({ key: "updated", dir: "desc" });
  });
});

describe("deliveryUpdatedAtMs", () => {
  it("parses valid ISO timestamps and rejects null/empty/invalid", () => {
    expect(deliveryUpdatedAtMs("2026-03-01T12:00:00.000Z")).toBe(Date.parse("2026-03-01T12:00:00.000Z"));
    expect(deliveryUpdatedAtMs(null)).toBeNull();
    expect(deliveryUpdatedAtMs("")).toBeNull();
    expect(deliveryUpdatedAtMs("not-a-date")).toBeNull();
  });
});

describe("sortDeliveries", () => {
  it("defaults to updated descending with null/invalid dates last", () => {
    const ids = sortDeliveries(rows, DEFAULT_DELIVERY_SORT).map((r) => r.delivery_id);
    expect(ids).toEqual([ID.b, ID.a, ID.c, ID.d]);
  });

  it("puts null/invalid dates last in ascending updated sort too", () => {
    const ids = sortDeliveries(rows, { key: "updated", dir: "asc" }).map((r) => r.delivery_id);
    expect(ids.slice(0, 2)).toEqual([ID.a, ID.b]);
    expect(ids.slice(2)).toEqual([ID.c, ID.d]);
  });

  it("sorts title and vendor case-insensitively", () => {
    expect(sortDeliveries(rows, { key: "title", dir: "asc" }).map((r) => r.title)).toEqual([
      "Alpha",
      "Beta",
      "Delta",
      "Gamma",
    ]);
    expect(sortDeliveries(rows, { key: "vendor", dir: "asc" }).map((r) => r.vendor_name)).toEqual([
      "Acme",
      "Mid",
      "Mid",
      "Zulu",
    ]);
  });

  it("sorts by status and breaks ties with delivery_id", () => {
    const livePair: DeliveryBrowseRow[] = [
      { ...rows[1], delivery_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", status: "live", updated_at: "2026-02-01T00:00:00.000Z" },
      { ...rows[1], delivery_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "live", updated_at: "2026-02-01T00:00:00.000Z" },
    ];
    expect(sortDeliveries(livePair, { key: "status", dir: "asc" }).map((r) => r.delivery_id)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
    ]);
  });

  it("does not mutate the input", () => {
    const before = rows.map((r) => r.delivery_id);
    sortDeliveries(rows, { key: "title", dir: "asc" });
    expect(rows.map((r) => r.delivery_id)).toEqual(before);
  });

  it("uses delivery_id as the final tie-breaker, not input order", () => {
    const sameUpdated: DeliveryBrowseRow[] = [
      { ...rows[0], delivery_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", updated_at: "2026-05-01T00:00:00.000Z" },
      { ...rows[0], delivery_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", updated_at: "2026-05-01T00:00:00.000Z" },
      { ...rows[0], delivery_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", updated_at: "2026-05-01T00:00:00.000Z" },
    ];
    expect(sortDeliveries(sameUpdated, { key: "updated", dir: "desc" }).map((r) => r.delivery_id)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
    ]);
  });
});

describe("deliveryStatusTone", () => {
  it("maps live/active, terminal muted, others neutral", () => {
    expect(deliveryStatusTone("live")).toBe("active");
    expect(deliveryStatusTone("pending")).toBe("neutral");
    expect(deliveryStatusTone("delivered")).toBe("neutral");
    expect(deliveryStatusTone("rejected")).toBe("muted");
    expect(deliveryStatusTone("taken_down")).toBe("muted");
  });
});

describe("buildDeliveriesQuery / hrefs", () => {
  it("omits default status and sort from the querystring", () => {
    expect(buildDeliveriesQuery({ status: "all", sort: DEFAULT_DELIVERY_SORT })).toBe("");
    expect(buildDeliveriesQuery({ status: "live", sort: DEFAULT_DELIVERY_SORT })).toBe("?status=live");
    expect(
      buildDeliveriesQuery({ status: "all", sort: { key: "title", dir: "asc" } }),
    ).toBe("?sort=title&dir=asc");
  });

  it("preserves the other dimension when building filter/sort links", () => {
    expect(deliveriesStatusHref("live", { key: "title", dir: "asc" }, "all")).toBe(
      "/deliveries?sort=title&dir=asc",
    );
    expect(deliveriesStatusHref("all", DEFAULT_DELIVERY_SORT, "pending")).toBe(
      "/deliveries?status=pending",
    );
    expect(deliveriesSortHref("live", DEFAULT_DELIVERY_SORT, "title")).toBe(
      "/deliveries?status=live&sort=title&dir=asc",
    );
    expect(deliveriesSortHref("live", DEFAULT_DELIVERY_SORT, "updated")).toBe(
      "/deliveries?status=live&sort=updated&dir=asc",
    );
  });
});
