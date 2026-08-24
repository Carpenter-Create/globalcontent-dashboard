import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";

import { createClient } from "./server";
import { getAuthUser, type AuthUser } from "./auth";
import type { Database } from "./database.types";

export type OrgRole = Database["public"]["Enums"]["org_role"];
export type OrgStatus = Database["public"]["Enums"]["org_status"];
export type OrgRow = { id: string; name: string; status: OrgStatus };

export type OrgContext = {
  user: AuthUser;
  /** Active memberships with their org, RLS-scoped. */
  rows: { role: OrgRole; organizations: OrgRow }[];
  orgs: { id: string; name: string }[];
  activeOrg: OrgRow | null;
  activeRole: OrgRole | null;
  /** account_owner or delivery_ops on the active org. */
  canOperate: boolean;
  isGcStaff: boolean;
  /** NOT awaited — see the note in getOrgContext. Unwrap with use() inside Suspense. */
  unread: Promise<number>;
};

// The request-scoped answer to "who is this, which org are they in, what may they do".
//
// Two costs this removes, both measured:
//
// 1. DUPLICATION. The layout and the page beneath it each ran their own memberships
//    query (~9ms each) to resolve the same active org. React cache() makes that one
//    query per request no matter how many components ask.
//
// 2. SERIALISATION. memberships / gc_staff / my_unread_count are independent, but ran
//    one after another (~25ms total). Promise.all makes the cost the slowest one (~11ms)
//    instead of the sum.
//
// Returns null when unauthenticated — callers redirect.
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();

  // my_unread_count is DELIBERATELY NOT AWAITED. It exists to paint a number on a nav
  // badge, but it calls member_can() per notification row — a SECURITY DEFINER function
  // with its own subqueries — plus a NOT EXISTS per row. It was the slowest thing in this
  // batch and it blocked the entire page render for a decoration. The promise is handed
  // to the shell and unwrapped inside a Suspense boundary, so the page paints without it
  // and the badge fills in when it lands.
  // Wrapped in Promise.resolve because the Supabase builder is a PromiseLike, not a real
  // Promise — it has .then but no .catch, and an unhandled rejection here would crash the
  // request. A failed badge query resolves to 0 rather than breaking the page.
  const unread: Promise<number> = Promise.resolve(
    supabase.rpc("my_unread_count").then((r) => r.data ?? 0),
  ).catch(() => 0);

  // The rest are on the critical path — fire together, not in sequence.
  const [membershipsRes, gcStaffRes, cookieStore] = await Promise.all([
    supabase
      .from("memberships")
      .select("role, organizations(id, name, status)")
      .eq("user_id", user.id)
      .eq("status", "active"),
    supabase.from("gc_staff").select("user_id").eq("user_id", user.id).maybeSingle(),
    cookies(),
  ]);

  const rows = (membershipsRes.data ?? []).flatMap((m) =>
    m.organizations ? [{ role: m.role, organizations: m.organizations }] : [],
  );

  const cookieOrg = cookieStore.get("gc_active_org")?.value ?? null;
  const activeRow = rows.find((m) => m.organizations.id === cookieOrg) ?? rows[0] ?? null;
  const activeRole = activeRow?.role ?? null;

  return {
    user,
    rows,
    orgs: rows.map((m) => ({ id: m.organizations.id, name: m.organizations.name })),
    activeOrg: activeRow?.organizations ?? null,
    activeRole,
    canOperate: activeRole === "account_owner" || activeRole === "delivery_ops",
    isGcStaff: !!gcStaffRes.data,
    unread,
  };
});
