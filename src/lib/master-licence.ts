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

// Master download is only for a licensed placement that is still active — same allow-list
// portal_resolve_download uses. 'pending' is excluded on purpose: a delivery that hasn't
// actually gone out yet is not "licensed" from the buyer's side of the table, whatever its
// paperwork says. Rejected/taken_down are excluded because the deal is off or pulled.
const ACTIVE_DELIVERY_STATUSES = new Set(["delivered", "live"]);

export function isMasterLicensed(deliveries: DeliveryForLicenceCheck[], now: Date = new Date()): boolean {
  return deliveries.some((d) => {
    if (!ACTIVE_DELIVERY_STATUSES.has(d.status)) return false;

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
