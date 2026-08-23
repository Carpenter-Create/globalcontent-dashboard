import { describe, expect, it } from "vitest";

import { Constants } from "@/lib/supabase/database.types";
import {
  CLIENTS_PAGE,
  ORG_ROLE_LABELS,
  ORG_STATUS_LABELS,
  tierCell,
  toClientOrgs,
  type ClientDirectoryRow,
} from "./clients";

function row(over: Partial<ClientDirectoryRow> = {}): ClientDirectoryRow {
  return {
    user_id: "11111111-1111-4111-8111-111111111111",
    email: "jane@acmefilms.com",
    org_id: "22222222-2222-4222-8222-222222222222",
    organization: "Acme Films",
    org_status: "active",
    role: "account_owner",
    joined_at: "2026-08-03T10:00:00Z",
    last_sign_in: "2026-08-14T09:00:00Z",
    tier: "pro",
    term_expires_at: "2027-08-03T10:00:00Z",
    subscription_status: "active",
    ...over,
  };
}

describe("CLIENTS_PAGE copy", () => {
  it("locks the staff Clients empty line", () => {
    expect(CLIENTS_PAGE.empty).toBe("No clients yet.");
    expect(CLIENTS_PAGE.empty.toLowerCase()).not.toContain("add");
  });
});

// The label maps are driven off the generated enum constants rather than a hand-copied
// list: a migration that adds an org status or role fails these instead of silently
// rendering `undefined` in the operator table.
describe("label maps cover the schema", () => {
  it("labels every org role", () => {
    for (const role of Constants.public.Enums.org_role) {
      expect(ORG_ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it("labels every org status", () => {
    for (const status of Constants.public.Enums.org_status) {
      expect(ORG_STATUS_LABELS[status]).toBeTruthy();
    }
  });
});

/**
 * Contract tier and Stripe status are two facts. The tier cell shows the contract, and adds
 * the billing status only when it is abnormal — a failing card is invisible in the contract
 * for the 30 days before lapse_org appends the access term.
 */
describe("tierCell", () => {
  it("shows the contract tier label on its own when billing is healthy", () => {
    expect(tierCell("premium", "active")).toBe("Premium");
  });

  it("appends the Stripe status when it is not active", () => {
    expect(tierCell("pro", "past_due")).toBe("Pro · past_due");
  });

  it("stays clean for Access, which has no Stripe subscription at all", () => {
    // $0 annual: a missing subscription row is the normal state, not a payment problem.
    expect(tierCell("access", null)).toBe("Access");
  });

  it("never defaults a missing contract to a tier", () => {
    // Either "signed up, never contracted" or the unregistered live webhook (SECURITY-STATUS
    // B5). Both are unknown, and unknown is not Access.
    expect(tierCell(null, null)).toBe("—");
  });

  it("still flags a bad status even when the contract row is missing", () => {
    expect(tierCell(null, "canceled")).toBe("— · canceled");
  });
});

/**
 * Organization, tier, and org status are facts about the ORG, not the person. Grouping states
 * them once per org so a client with three seats does not repeat its tier three times.
 */
describe("toClientOrgs", () => {
  it("collapses an org's seats under one entry with the org facts stated once", () => {
    const orgs = toClientOrgs([
      row({ user_id: "u1", email: "jane@acmefilms.com", role: "account_owner" }),
      row({ user_id: "u2", email: "sam@acmefilms.com", role: "viewer" }),
    ]);

    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({
      organization: "Acme Films",
      tier: "Pro",
      status: "Active",
      termEnds: "Aug 2027",
    });
    expect(orgs[0].seats).toEqual([
      { userId: "u1", email: "jane@acmefilms.com", role: "Account owner", lastSeen: "Aug 14, 2026" },
      { userId: "u2", email: "sam@acmefilms.com", role: "Viewer", lastSeen: "Aug 14, 2026" },
    ]);
  });

  it("keeps the RPC's ordering for both orgs and the seats inside them", () => {
    const orgs = toClientOrgs([
      row({ org_id: "a", organization: "Aaa Films", user_id: "u1", email: "a@test" }),
      row({ org_id: "a", organization: "Aaa Films", user_id: "u2", email: "b@test" }),
      row({ org_id: "z", organization: "Zzz Pictures", user_id: "u3", email: "c@test" }),
    ]);
    expect(orgs.map((o) => o.organization)).toEqual(["Aaa Films", "Zzz Pictures"]);
    expect(orgs[0].seats.map((s) => s.email)).toEqual(["a@test", "b@test"]);
  });

  it("does not merge two orgs that happen to share a name", () => {
    // Org names are free text and not unique; grouping on the name would silently fuse two
    // separate clients into one row.
    const orgs = toClientOrgs([
      row({ org_id: "one", organization: "Northlight", user_id: "u1", email: "a@test" }),
      row({ org_id: "two", organization: "Northlight", user_id: "u2", email: "b@test" }),
    ]);
    expect(orgs).toHaveLength(2);
  });

  it("carries a billing divergence at the org level", () => {
    const [org] = toClientOrgs([row({ tier: "pro", subscription_status: "past_due" })]);
    expect(org.tier).toBe("Pro · past_due");
  });

  it("has no term line for an org that never contracted", () => {
    const [org] = toClientOrgs([row({ tier: null, term_expires_at: null, subscription_status: null })]);
    expect(org.tier).toBe("—");
    expect(org.termEnds).toBeNull();
  });

  it("does not invent a last-seen date for a user who never signed in", () => {
    const [org] = toClientOrgs([row({ last_sign_in: null })]);
    expect(org.seats[0].lastSeen).toBe("—");
  });

  it("returns nothing when the RPC returned nothing", () => {
    expect(toClientOrgs(null)).toEqual([]);
    expect(toClientOrgs([])).toEqual([]);
  });
});
