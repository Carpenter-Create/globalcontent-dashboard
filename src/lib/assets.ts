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
export const CLIENT_VIEWABLE_ASSET_KINDS = ["poster", "banner", "artwork", "caption"] as const;

export function isClientViewableAssetKind(kind: string): boolean {
  return (CLIENT_VIEWABLE_ASSET_KINDS as readonly string[]).includes(kind);
}

/**
 * Which asset kind /api/screener/url will serve this caller, or null if it will refuse.
 * Mirrors the route's split exactly: staff may fall back to the master, a client may only
 * ever be served a dedicated screener. Used by the page so the Watch button is only
 * rendered when the request behind it can actually succeed.
 */
export function screenerKindFor(
  screenerSource: string | null,
  isGcStaff: boolean,
): AssetKind | null {
  if (screenerSource === "dedicated") return "screener";
  return isGcStaff ? "master" : null;
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
