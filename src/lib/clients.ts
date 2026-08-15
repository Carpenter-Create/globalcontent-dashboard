import type { Database } from "@/lib/supabase/database.types";

export type OrgRole = Database["public"]["Enums"]["org_role"];
export type OrgStatus = Database["public"]["Enums"]["org_status"];

// One active seat on one client org, as returned by gc_client_directory().
export type ClientDirectoryRow = {
  user_id: string;
  email: string | null;
  org_id: string;
  organization: string;
  org_status: OrgStatus;
  role: OrgRole;
  joined_at: string;
  last_sign_in: string | null;
};

export type ClientRow = {
  userId: string;
  email: string;
  organization: string;
  role: string;
  status: string;
  joined: string;
  lastSeen: string;
};

export const CLIENTS_PAGE = {
  title: "Clients",
  subtitle: "Every person holding an active seat on a client organization.",
  empty: "No client organizations yet.",
} as const;

// Role vocabulary matches the capability names in member_can, spelled for reading.
export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  account_owner: "Account owner",
  accountant: "Accountant",
  legal: "Legal",
  delivery_ops: "Delivery ops",
  viewer: "Viewer",
};

// Org lifecycle as GC sees it. Deliberately plain: an operator needs the state, not a
// reassuring euphemism for it.
export const ORG_STATUS_LABELS: Record<OrgStatus, string> = {
  registered: "Registered",
  awaiting_payment: "Awaiting payment",
  active: "Active",
  payment_lapsed: "Payment lapsed",
  closed: "Closed",
};

const NO_VALUE = "—";

// UTC so a row reads the same for every operator, and so tests do not depend on the
// machine's timezone.
const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

function day(iso: string | null): string {
  return iso ? fmt.format(new Date(iso)) : NO_VALUE;
}

// Display shaping only. Order is the RPC's (organization, then email) — re-sorting here
// would fight the ordering the function already guarantees.
export function toClientRows(rows: ClientDirectoryRow[] | null): ClientRow[] {
  return (rows ?? []).map((r) => ({
    userId: r.user_id,
    email: r.email ?? NO_VALUE,
    organization: r.organization,
    role: ORG_ROLE_LABELS[r.role],
    status: ORG_STATUS_LABELS[r.org_status],
    joined: day(r.joined_at),
    lastSeen: day(r.last_sign_in),
  }));
}
