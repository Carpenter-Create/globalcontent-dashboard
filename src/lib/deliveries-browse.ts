// Pure helpers for the client /deliveries browse surface. URL parsing, row validation,
// filter, sort, status-chip tone, page-view copy, and query construction — unit-tested in
// isolation. The page composes DataTable / StatusFilter / EmptyState; this module never
// touches React or Supabase. RPC rows are untrusted until validated.

import {
  buildQuery,
  nextSort,
  parseSort,
  type Sort,
  type SortDir,
} from "@/lib/catalog-view";
import { DELIVERY_STATUS_ROW_LABELS, type DeliveryStatus } from "@/lib/titles";

export type DeliveryBrowseRow = {
  delivery_id: string;
  title_id: string;
  title: string;
  vendor_name: string;
  territory: string;
  status: DeliveryStatus;
  updated_at: string | null;
};

export type DeliveryStatusFilter = "all" | DeliveryStatus;

export const DELIVERY_STATUSES = [
  "pending",
  "delivered",
  "live",
  "rejected",
  "taken_down",
] as const satisfies readonly DeliveryStatus[];

const DELIVERY_STATUS_SET = new Set<string>(DELIVERY_STATUSES);

export const DELIVERY_STATUS_FILTERS: { key: DeliveryStatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: DELIVERY_STATUS_ROW_LABELS.pending },
  { key: "delivered", label: DELIVERY_STATUS_ROW_LABELS.delivered },
  { key: "live", label: DELIVERY_STATUS_ROW_LABELS.live },
  { key: "rejected", label: DELIVERY_STATUS_ROW_LABELS.rejected },
  { key: "taken_down", label: DELIVERY_STATUS_ROW_LABELS.taken_down },
];

const STATUS_FILTER_KEYS = new Set<string>(DELIVERY_STATUS_FILTERS.map((f) => f.key));

export const DELIVERY_SORT_KEYS = ["updated", "title", "vendor", "status"] as const;
export type DeliverySortKey = (typeof DELIVERY_SORT_KEYS)[number];

export const DEFAULT_DELIVERY_SORT: Sort = { key: "updated", dir: "desc" };

export const DELIVERY_SORT_INITIAL_DIR: Record<DeliverySortKey, SortDir> = {
  updated: "desc",
  title: "asc",
  vendor: "asc",
  status: "asc",
};

/** Canonical 8-4-4-4-12 hex UUID (any version/variant); stored lowercase. */
const CANONICAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UUID_RE.test(value);
}

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return typeof value === "string" && DELIVERY_STATUS_SET.has(value);
}

/**
 * Fail-closed parse of one untrusted RPC row. Malformed ids/status/fields → null
 * (do not render, link, or pass into StatusChip / label maps).
 */
export function asDeliveryBrowseRow(row: unknown): DeliveryBrowseRow | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;

  if (!isCanonicalUuid(r.delivery_id) || !isCanonicalUuid(r.title_id)) return null;
  if (!isDeliveryStatus(r.status)) return null;
  if (typeof r.title !== "string") return null;
  if (typeof r.vendor_name !== "string") return null;
  if (typeof r.territory !== "string") return null;

  let updated_at: string | null;
  if (r.updated_at == null) {
    updated_at = null;
  } else if (typeof r.updated_at === "string") {
    updated_at = r.updated_at === "" ? null : r.updated_at;
  } else {
    return null;
  }

  return {
    delivery_id: r.delivery_id.toLowerCase(),
    title_id: r.title_id.toLowerCase(),
    title: r.title,
    vendor_name: r.vendor_name,
    territory: r.territory,
    status: r.status,
    updated_at,
  };
}

/** Keep only validated rows from an untrusted `my_deliveries` payload. */
export function normalizeMyDeliveries(data: unknown): DeliveryBrowseRow[] {
  if (!Array.isArray(data)) return [];
  const out: DeliveryBrowseRow[] = [];
  for (const row of data) {
    const parsed = asDeliveryBrowseRow(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function deliveryTitleHref(row: DeliveryBrowseRow): string {
  return `/titles/${row.title_id}`;
}

export type DeliveryChipTone = "neutral" | "active" | "muted";

export function deliveryStatusTone(status: DeliveryStatus): DeliveryChipTone {
  if (status === "live") return "active";
  if (status === "rejected" || status === "taken_down") return "muted";
  return "neutral";
}

/** Label + tone for a validated status only — never call with untrusted status. */
export function deliveryStatusDisplay(status: DeliveryStatus): {
  label: string;
  tone: DeliveryChipTone;
} {
  return {
    label: DELIVERY_STATUS_ROW_LABELS[status],
    tone: deliveryStatusTone(status),
  };
}

export const DELIVERIES_NO_DATA = {
  title: "No deliveries yet",
  description: "Placements appear here once a title is delivered to a platform.",
  actionLabel: "View titles",
  actionHref: "/titles",
} as const;

export const DELIVERIES_FILTER_MISS = {
  title: "No deliveries match this status",
  description: "Try another status, or clear the filter.",
  actionLabel: "Show all",
} as const;

type QueryValue = string | string[] | undefined;

/** Array-shaped or non-string query values are invalid — never trust the URL. */
function scalarQuery(v: QueryValue): string | undefined {
  if (typeof v !== "string") return undefined;
  return v;
}

export function parseDeliveryStatusFilter(v: QueryValue): DeliveryStatusFilter {
  const s = scalarQuery(v);
  if (s && STATUS_FILTER_KEYS.has(s)) return s as DeliveryStatusFilter;
  return "all";
}

export function filterDeliveries(
  rows: readonly DeliveryBrowseRow[],
  status: DeliveryStatusFilter,
): DeliveryBrowseRow[] {
  if (status === "all") return [...rows];
  return rows.filter((r) => r.status === status);
}

export function parseDeliverySort(sortParam: QueryValue, dirParam: QueryValue): Sort {
  return parseSort(scalarQuery(sortParam), scalarQuery(dirParam), DELIVERY_SORT_KEYS, DEFAULT_DELIVERY_SORT);
}

/** Valid finite epoch ms, or null when missing/invalid (always sorts last). */
export function deliveryUpdatedAtMs(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function primarySortValue(
  key: DeliverySortKey,
  row: DeliveryBrowseRow,
): string | number | null {
  switch (key) {
    case "updated":
      return deliveryUpdatedAtMs(row.updated_at);
    case "title":
      return row.title.toLowerCase();
    case "vendor":
      return row.vendor_name.toLowerCase();
    case "status":
      return row.status;
  }
}

/**
 * Sort deliveries by the active key/dir. Null/invalid dates always sort last.
 * Equal primary keys break ties by delivery_id ascending (deterministic; not RPC order).
 * Does not mutate the input.
 */
export function sortDeliveries(
  rows: readonly DeliveryBrowseRow[],
  sort: Sort,
): DeliveryBrowseRow[] {
  const key = (DELIVERY_SORT_KEYS as readonly string[]).includes(sort.key)
    ? (sort.key as DeliverySortKey)
    : (DEFAULT_DELIVERY_SORT.key as DeliverySortKey);
  const dir: SortDir = sort.dir === "asc" || sort.dir === "desc" ? sort.dir : DEFAULT_DELIVERY_SORT.dir;
  const sign = dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const av = primarySortValue(key, a);
    const bv = primarySortValue(key, b);
    const an = av == null || av === "";
    const bn = bv == null || bv === "";
    if (an && bn) {
      return a.delivery_id.localeCompare(b.delivery_id);
    }
    if (an) return 1;
    if (bn) return -1;
    let cmp: number;
    if (typeof av === "number" && typeof bv === "number") {
      cmp = av === bv ? 0 : av < bv ? -1 : 1;
    } else {
      cmp = String(av).localeCompare(String(bv));
    }
    if (cmp !== 0) return cmp * sign;
    return a.delivery_id.localeCompare(b.delivery_id);
  });
}

/** Build /deliveries querystring; omits default status/sort for a clean canonical URL. */
export function buildDeliveriesQuery(opts: {
  status: DeliveryStatusFilter;
  sort: Sort;
  override?: { status?: DeliveryStatusFilter; sort?: Sort };
}): string {
  const status = opts.override?.status ?? opts.status;
  const sort = opts.override?.sort ?? opts.sort;
  const isDefaultSort =
    sort.key === DEFAULT_DELIVERY_SORT.key && sort.dir === DEFAULT_DELIVERY_SORT.dir;
  return buildQuery({
    status: status === "all" ? undefined : status,
    sort: isDefaultSort ? undefined : sort.key,
    dir: isDefaultSort ? undefined : sort.dir,
  });
}

export function deliveriesStatusHref(
  currentStatus: DeliveryStatusFilter,
  currentSort: Sort,
  nextStatus: DeliveryStatusFilter,
): string {
  const q = buildDeliveriesQuery({
    status: currentStatus,
    sort: currentSort,
    override: { status: nextStatus },
  });
  return `/deliveries${q}`;
}

export function deliveriesSortHref(
  currentStatus: DeliveryStatusFilter,
  currentSort: Sort,
  columnKey: string,
): string {
  const initial =
    DELIVERY_SORT_INITIAL_DIR[columnKey as DeliverySortKey] ?? ("asc" as SortDir);
  const next = nextSort(currentSort, columnKey, initial);
  const q = buildDeliveriesQuery({
    status: currentStatus,
    sort: currentSort,
    override: { sort: next },
  });
  return `/deliveries${q}`;
}

/** Filter-miss "Show all" destination while preserving the active sort. */
export function deliveriesShowAllHref(
  currentStatus: DeliveryStatusFilter,
  currentSort: Sort,
): string {
  return deliveriesStatusHref(currentStatus, currentSort, "all");
}
