// The master-download gate — pure, testable, and deliberately separate from buyer-page.ts's
// buyerActionsFor. buyerActionsFor only ever sees a boolean `licensed`; THIS is where that
// boolean gets computed from raw delivery + grant rows. It is the single highest-risk
// judgment in the buyer portal (task-9 brief): get it wrong and an unwatermarked master
// reaches a party with no active licence for it.
//
// NEVER inferred from the title alone: a link is scoped to (title, vendor_id), so this must
// be re-derived from deliveries + rights_grants for THAT SPECIFIC vendor on THAT SPECIFIC
// title. If it were computed at the title level, the moment ANY vendor licensed the title,
// every other prospect still holding a screener_view link would qualify for the master too —
// the exact failure per-recipient links exist to prevent (see the recipient-scoping
// migrations, 20260806000200 / 20260806000300).
//
// Mirrors portal_resolve_download's rule-12 recheck (20260720000100_portal_gate.sql: active
// grant, in-window, territory-covered) but re-implemented in TS rather than called as that
// RPC — that RPC resolves a DIFFERENT link shape (purpose = 'master_download', keyed by
// delivery_id) than the buyer's screener_view link (keyed by title_id + vendor_id). There is
// no shared RPC for this shape, so the check is duplicated here deliberately rather than
// bent to fit the wrong resolver.
export type DeliveryForLicenceCheck = {
  status: string;
  territory: string;
  // null means "no grant joined" (should never happen — grant_id is NOT NULL on deliveries —
  // but a defensive read must not assume the join always succeeds). Treated as unlicensed.
  grant: {
    effective_to: string | null;
    window_start: string | null;
    window_end: string | null;
    territory_mode: string;
    territories: string[];
  } | null;
};

// Same allow-list as portal_resolve_download's own status check, 20260720000100_portal_gate.sql
// line 176 (`if v_deliv.status not in ('pending','delivered','live') then raise exception...`)
// AND title_vendor_licensed's (20260806000400_attach_link_vendor.sql,
// `d.status in ('pending', 'delivered', 'live')`). 'pending' IS included, deliberately matching
// those lines rather than a narrower "already live" reading: delivery here is entirely manual,
// and in the buyer portal THIS DOWNLOAD IS THE HANDOVER — a delivery is created 'pending' and
// stays that way until a person marks it delivered, so the row is still 'pending' at exactly
// the moment the buyer needs the file. A narrower list would refuse the very licensed buyer
// this route exists to serve. Rejected/taken_down are excluded because the deal is off or
// pulled.
//
// Exported (fix round 3, item 6) so master-licence.test.ts can pin the exact list, not just
// this function's behaviour on a few sample statuses — this predicate already drifted once
// (the 'pending' status), and it is duplicated a THIRD time in SQL by title_vendor_licensed,
// with no shared source and no test tying the three together. A pgTAP test on the SQL side
// (master_licence_status_parity_test.sql) asserts portal_resolve_download and
// title_vendor_licensed agree with EACH OTHER and with this exact list; a one-sided edit to
// any of the three copies now fails a test instead of waiting for a bug report.
export const ACTIVE_DELIVERY_STATUSES_LIST = ["pending", "delivered", "live"] as const;
const ACTIVE_DELIVERY_STATUSES = new Set<string>(ACTIVE_DELIVERY_STATUSES_LIST);

export function isMasterLicensed(deliveries: DeliveryForLicenceCheck[], now: Date = new Date()): boolean {
  return deliveries.some((d) => {
    if (!ACTIVE_DELIVERY_STATUSES.has(d.status)) return false;

    // NOT NULL + CHECKed to ISO alpha-2 in the schema, so this is unreachable today — but a
    // defensive read must fail closed here rather than let a missing territory fall through
    // to `!territories.includes(undefined)`, which is `true` and would WRONGLY ALLOW under
    // exclude-mode. The SQL this mirrors is null-propagating (`not (null = any(...))` is
    // NULL, not TRUE, so the enclosing `exists` refuses) — this matches that direction.
    if (!d.territory) return false;

    const g = d.grant;
    if (!g) return false; // no grant on record — refuse, never assume coverage

    // Rule 8/12: effective_to is set ONLY on natural term expiry (grants never shrink by
    // edit — they are append-only). A non-null value here means this specific grant's term
    // has ended, even though the delivery row itself was never touched.
    if (g.effective_to !== null) return false;
    if (g.window_start && now < new Date(g.window_start)) return false;
    if (g.window_end && now > new Date(g.window_end)) return false;

    switch (g.territory_mode) {
      case "world":
        return true;
      case "include":
        return g.territories.includes(d.territory);
      case "exclude":
        return !g.territories.includes(d.territory);
      default:
        // Unknown territory_mode (schema drift) — fail closed rather than guess.
        return false;
    }
  });
}
