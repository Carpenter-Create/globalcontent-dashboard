// Staff /vendors address book. Copy and list helpers live here, not in JSX.
// The list page is identity + empty OR identity + directory. Create is a
// separate surface. Do not invent fixture vendors.

export const VENDORS_PAGE = {
  title: "Vendors",
  identity: "Credentials are never stored here.",
  emptyTitle: "No vendors yet",
  addVendor: "Add vendor",
  addHref: "/vendors/new",
} as const;

export const VENDOR_MODE_LABELS: Record<"portal_upload" | "email", string> = {
  portal_upload: "Portal upload",
  email: "Email",
};

export type VendorDeliveryMode = keyof typeof VENDOR_MODE_LABELS;

export type VendorDirectoryRow = {
  id: string;
  name: string;
  deliveryMode: VendorDeliveryMode;
  active: boolean;
};

/** Fields that belong on the create/edit form — never on the address-book page. */
export const VENDOR_FORM_FIELD_LABELS = [
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
] as const;

export function asVendorDirectoryRow(row: unknown): VendorDirectoryRow | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (typeof r.name !== "string" || r.name.length === 0) return null;
  if (r.delivery_mode !== "portal_upload" && r.delivery_mode !== "email") return null;
  if (typeof r.active !== "boolean") return null;
  return {
    id: r.id,
    name: r.name,
    deliveryMode: r.delivery_mode,
    active: r.active,
  };
}

/** Keep only real vendor rows. Empty or malformed payloads become an empty directory. */
export function normalizeVendorDirectory(data: unknown): VendorDirectoryRow[] {
  if (!Array.isArray(data)) return [];
  const out: VendorDirectoryRow[] = [];
  for (const row of data) {
    const parsed = asVendorDirectoryRow(row);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function vendorDirectoryHref(row: VendorDirectoryRow): string {
  return `/vendors/${row.id}`;
}

export function vendorDirectoryMeta(row: VendorDirectoryRow): string {
  const mode = VENDOR_MODE_LABELS[row.deliveryMode];
  return row.active ? mode : `${mode} · inactive`;
}
