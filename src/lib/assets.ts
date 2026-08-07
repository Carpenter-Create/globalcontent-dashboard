import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export const PART_SIZE = 64 * 1024 * 1024; // 64 MiB

type AssetKind = Database["public"]["Enums"]["asset_kind"];

// THE single source of truth for which asset kinds /api/assets/url will sign, imported by
// both the route and the UI. Kept here, and imported rather than repeated, because the
// failure mode of duplicating it is a button that renders and then 404s — which is exactly
// what happened when the route learned this rule and the page did not.
//
// An ALLOW-list, not a deny-list: a future asset_kind is unreachable until someone
// consciously adds it, rather than becoming downloadable the moment the enum grows.
//
// `master` and `screener` are excluded. `assets_select` gates on member_can(...,'view'),
// which admits ALL FIVE org roles including `viewer` — a role CLAUDE.md scopes to "catalog
// read-only". Masters reach vendors through the OTP-gated portal, which re-checks delivery
// status and the rights grant on every request; they do not need a second path.
//
// `trailer` IS included. It is promotional material the client supplied and routinely needs
// back — unlike the master, it carries no risk in a `viewer`'s hands. Flip it out of this
// list if that judgement is wrong; nothing else depends on the choice.
export const CLIENT_VIEWABLE_ASSET_KINDS = [
  "poster",
  "banner",
  "artwork",
  "caption",
  "trailer",
] as const;

export function isClientViewableAssetKind(kind: string): boolean {
  return (CLIENT_VIEWABLE_ASSET_KINDS as readonly string[]).includes(kind);
}

// Statuses at or past GC approval. Approving a title sets 'in_delivery'
// (20260719000100_title_reviews.sql:99), so everything from there on has been approved;
// 'draft' | 'submitted' | 'in_review' have not.
export const POST_APPROVAL_TITLE_STATUSES = [
  "in_delivery",
  "live",
  "takedown_requested",
  "taken_down",
] as const;

export function isPostApprovalTitleStatus(status: string | null): boolean {
  return (POST_APPROVAL_TITLE_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * Which asset kind /api/screener/url will serve this caller, or null if it will refuse.
 * THE shared rule — the route calls this too, so the button and the request behind it
 * cannot drift (they did once: the route learned a rule the page did not, and the button
 * rendered then 404'd).
 *
 * ── Who gets the master fallback, and why ──────────────────────────────────────────────
 * There is no transcoding, watermarking or DRM here by design, so on the
 * screener_source = 'master' default the "screener" IS the master, byte for byte.
 *
 *   gc_staff — any status. Screening is how GC performs the chain-of-title review, and
 *              reviewers work on titles that are in_review with no dedicated screener.
 *
 *   client   — ANY org role, but only once GC has approved the title. A rights holder must
 *              be able to watch their own approved title to show it to a prospective buyer;
 *              before approval there is nothing to show and the review is still GC's.
 *              Founder decision, 2026-08-06 — this deliberately replaces an earlier
 *              dedicated-screener-only rule for clients.
 *
 * NOTE this governs WATCHING IN-APP only. Minting a shareable outside link is a separate
 * act with its own authorization (create_screener_link — GC or an operate-capable org member
 * since 20260806000200; no longer gc_staff-only).
 */
export function screenerKindFor(
  screenerSource: string | null,
  isGcStaff: boolean,
  titleStatus: string | null,
): AssetKind | null {
  // Rule 11 (fix round 3, item 2): enforce at the point of action, not just at mint.
  // 'taken_down' is deliberately still a member of POST_APPROVAL_TITLE_STATUSES — that list
  // separately answers "was this title ever approved," which other consumers (e.g.
  // ScreenerSourceControl's isPostApproval prop) need to keep reading true for a taken-down
  // title. But a title that has been WITHDRAWN must not keep handing its screener (or, on the
  // master-source default, the master itself) to a client just because it once cleared
  // approval — that would leave create_screener_link's mint-time takedown refusal
  // (20260806000200) enforcing nothing for every link minted before the takedown. GC staff are
  // exempt: reviewing/auditing a taken-down title is exactly why staff can screen any status.
  if (!isGcStaff && titleStatus === "taken_down") return null;
  if (!isGcStaff && !isPostApprovalTitleStatus(titleStatus)) return null;
  return screenerSource === "dedicated" ? "screener" : "master";
}

// Server-derived S3 key. crypto.randomUUID() namespaces each upload so re-uploads
// never collide. The filename tail is cosmetic; authz never trusts the key.
export function assetKey(
  orgId: string,
  titleId: string,
  kind: string,
  filename: string,
): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120) || "file";
  return `orgs/${orgId}/titles/${titleId}/${kind}/${crypto.randomUUID()}/${safe}`;
}

// Authz for the route handlers: confirm the title is visible to the caller (RLS)
// AND the caller has 'operate' in that title's org. Returns the org id or null.
// (create_asset re-checks at the DB layer; this pre-check avoids presigning for
// someone who can't operate.)
//
// MUST scope memberships to userId: the memberships RLS policy returns ALL
// co-members' rows in the caller's orgs, so an unscoped .maybeSingle() would
// return null (multi-row) in any 2+ member org and 403 everyone. GC staff have
// no membership row and are not a client upload actor in v1 (view-as-client,
// §22, is a later seam) — the create_asset RPC remains their DB-level path.
export async function resolveOperableTitle(
  supabase: SupabaseClient<Database>,
  titleId: string,
  userId: string,
): Promise<{ orgId: string } | null> {
  const { data: title } = await supabase
    .from("titles")
    .select("org_id")
    .eq("id", titleId)
    .maybeSingle();
  if (!title) return null; // RLS hides other orgs' titles

  const { data: m } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", title.org_id)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  const canOperate = m?.role === "account_owner" || m?.role === "delivery_ops";
  return canOperate ? { orgId: title.org_id } : null;
}
