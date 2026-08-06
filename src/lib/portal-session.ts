import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken } from "@/lib/portal";

// Re-resolves a buyer's screener_view link + session from the raw session-cookie value,
// entirely against the ADMIN client — a portal recipient carries no JWT, so there is no RLS
// backstop, and every filter below must be explicit rather than delegated to a policy.
//
// This mirrors, in TS, exactly what portal_resolve_screener enforces in SQL for the same
// link purpose (session not revoked and unexpired; link purpose = 'screener_view', not
// revoked, not expired) — see 20260720000300_screener_room.sql. It exists as a standalone
// helper (rather than a new RPC) because the two routes that need it, metadata-export and
// master-download, need fields (vendor_id, recipient_name) that no existing RPC returns:
// portal_resolve_download resolves a DIFFERENT link shape (master_download, keyed by
// delivery_id) and portal_resolve_screener deliberately carries NO rule-12 gate (it is the
// pitch-view resolver) and doesn't return vendor_id either.
//
// Returns null on ANY ambiguity — missing session, missing link, wrong purpose, no title_id,
// revoked, or expired. The caller's job is to turn that into a 403/401; this function never
// half-resolves.
export type ResolvedBuyerLink = {
  linkId: string;
  sessionId: string;
  titleId: string;
  vendorId: string | null;
  recipientName: string | null;
};

export async function resolveBuyerLink(rawSessionToken: string): Promise<ResolvedBuyerLink | null> {
  const admin = createAdminClient();

  const { data: session } = await admin
    .from("portal_sessions")
    .select("id, link_id, expires_at, revoked_at")
    .eq("token_hash", hashToken(rawSessionToken))
    .maybeSingle();
  if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) return null;

  const { data: link } = await admin
    .from("portal_links")
    .select("id, purpose, title_id, vendor_id, recipient_name, expires_at, revoked_at")
    .eq("id", session.link_id)
    .maybeSingle();
  if (!link || link.purpose !== "screener_view" || !link.title_id) return null;
  if (link.revoked_at || new Date(link.expires_at) < new Date()) return null;

  return {
    linkId: link.id,
    sessionId: session.id,
    titleId: link.title_id,
    vendorId: link.vendor_id,
    recipientName: link.recipient_name,
  };
}
