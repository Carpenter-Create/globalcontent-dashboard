import { describe, expect, it } from "vitest";

import { Constants } from "@/lib/supabase/database.types";
import {
  ORG_ROLE_LABELS,
  ORG_STATUS_LABELS,
  toClientRows,
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
    ...over,
  };
}

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

describe("toClientRows", () => {
  it("labels role and status and formats the dates", () => {
    expect(toClientRows([row()])).toEqual([
      {
        userId: "11111111-1111-4111-8111-111111111111",
        email: "jane@acmefilms.com",
        organization: "Acme Films",
        role: "Account owner",
        status: "Active",
        joined: "Aug 3, 2026",
        lastSeen: "Aug 14, 2026",
      },
    ]);
  });

  it("preserves the order the RPC returned (org, then email)", () => {
    const rows = toClientRows([
      row({ organization: "Acme Films", email: "a@acme.test" }),
      row({ organization: "Acme Films", email: "b@acme.test" }),
      row({ organization: "Northlight", email: "c@north.test" }),
    ]);
    expect(rows.map((r) => `${r.organization}/${r.email}`)).toEqual([
      "Acme Films/a@acme.test",
      "Acme Films/b@acme.test",
      "Northlight/c@north.test",
    ]);
  });

  it("does not invent a value for a user with no email or no sign-in yet", () => {
    const [only] = toClientRows([row({ email: null, last_sign_in: null })]);
    expect(only.email).toBe("—");
    expect(only.lastSeen).toBe("—");
  });

  it("keeps a non-active org's status visible rather than hiding the row", () => {
    const [only] = toClientRows([row({ org_status: "payment_lapsed" })]);
    expect(only.status).toBe("Payment lapsed");
  });

  it("returns nothing when the RPC returned nothing", () => {
    expect(toClientRows(null)).toEqual([]);
    expect(toClientRows([])).toEqual([]);
  });
});
