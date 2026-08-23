import type { Database } from "@/lib/supabase/database.types";
import { TIER_META, type Tier } from "@/lib/agreements";

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
  /** Current contract term's tier. Null until a contract_terms row exists. */
  tier: Tier | null;
  term_expires_at: string | null;
  /** Stripe's own status string. Null for Access (no subscription) and for orgs that never paid. */
  subscription_status: string | null;
};

/** One person's seat. Only the facts that actually vary per person. */
export type ClientSeat = {
  userId: string;
  email: string;
  role: string;
  lastSeen: string;
};

/** One client organization and its seats. Org-level facts are stated once, here. */
export type ClientOrg = {
  orgId: string;
  organization: string;
  tier: string;
  status: string;
  /** Null when no contract term exists — there is no term to end. */
  termEnds: string | null;
  seats: ClientSeat[];
};

export const CLIENTS_PAGE = {
  title: "Clients",
  subtitle: "Every person holding an active seat on a client organization.",
  empty: "No clients yet.",
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
const monthFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function day(iso: string | null): string {
  return iso ? fmt.format(new Date(iso)) : NO_VALUE;
}

// A term end is a contractual horizon, not an appointment — month and year is the honest
// precision for a roster. The exact date lives on the contract.
function monthYear(iso: string): string {
  return monthFmt.format(new Date(iso));
}

/**
 * The contract tier, plus Stripe's status when it is abnormal.
 *
 * These are two facts and the divergence is the useful part: a failed card sits at
 * `past_due` for 30 days while the contract still reads Pro, until `lapse_org` appends the
 * access term. Showing only the contract would hide the one window where a call still helps.
 *
 * A null tier is NOT rendered as Access. It means either "signed up, never contracted" or the
 * unregistered live-mode webhook (SECURITY-STATUS B5) — both unknown. Labels come from
 * TIER_META so there is one tier vocabulary; its prices are stale and deliberately unused.
 */
export function tierCell(tier: Tier | null, subscriptionStatus: string | null): string {
  const label = tier ? TIER_META[tier].label : NO_VALUE;
  const healthy = subscriptionStatus === null || subscriptionStatus === "active";
  return healthy ? label : `${label} · ${subscriptionStatus}`;
}

/**
 * Group the flat RPC rows by organization.
 *
 * Keyed on org_id, never on the name: org names are free text and not unique, so grouping by
 * name would fuse two separate clients into one. Insertion order is preserved, which keeps the
 * RPC's own (organization, then email) ordering rather than re-sorting it here.
 */
export function toClientOrgs(rows: ClientDirectoryRow[] | null): ClientOrg[] {
  const byOrg = new Map<string, ClientOrg>();

  for (const r of rows ?? []) {
    let org = byOrg.get(r.org_id);
    if (!org) {
      org = {
        orgId: r.org_id,
        organization: r.organization,
        tier: tierCell(r.tier, r.subscription_status),
        status: ORG_STATUS_LABELS[r.org_status],
        termEnds: r.term_expires_at ? monthYear(r.term_expires_at) : null,
        seats: [],
      };
      byOrg.set(r.org_id, org);
    }
    org.seats.push({
      userId: r.user_id,
      email: r.email ?? NO_VALUE,
      role: ORG_ROLE_LABELS[r.role],
      lastSeen: day(r.last_sign_in),
    });
  }

  return [...byOrg.values()];
}
