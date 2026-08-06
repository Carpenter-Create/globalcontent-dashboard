"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth";
import { generateToken, hashToken } from "@/lib/portal";
import { escapeIlikePattern } from "@/lib/buyer-names";
import { resolveTerritories, type TerritoryMode } from "@/lib/territories";
import type { RightsType } from "@/lib/rights";
import { computeMetadataFindings, METADATA_LOGIC_VERSION } from "@/lib/metadata";
import type { Json } from "@/lib/supabase/database.types";

// Add a rights grant (expand = insert) for a title in the active org. Territories
// resolve to ISO codes server-side; the write goes through the add_rights_grant
// SECURITY DEFINER RPC (capability re-checked in the DB).
export async function addRights(input: {
  orgId: string;
  titleId: string;
  rightsTypes: RightsType[];
  mode: TerritoryMode;
  countryCodes: string[];
  exclusive: boolean;
  windowStart: string | null;
  windowEnd: string | null;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated." };
  if (input.rightsTypes.length === 0) return { error: "Select at least one rights type." };

  let territories: string[];
  try {
    territories = resolveTerritories(input.mode, input.countryCodes);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid territories." };
  }

  const { error } = await supabase.rpc("add_rights_grant", {
    p_org_id: input.orgId,
    p_title_id: input.titleId,
    p_rights_types: input.rightsTypes,
    p_mode: input.mode,
    p_territories: territories,
    p_exclusive: input.exclusive,
    p_window_start: input.windowStart ?? undefined,
    p_window_end: input.windowEnd ?? undefined,
    p_effective_from: new Date().toISOString(),
  });
  if (error) return { error: error.message };

  revalidatePath(`/titles/${input.titleId}`);
  return {};
}

// Set a title's screener source (master = the master doubles as the screener;
// dedicated = a separately-uploaded screener asset). Written via the
// set_screener_source RPC (operate-gated in the DB; titles is RPC-only-write).
export async function setScreenerSource(input: {
  titleId: string;
  source: "master" | "dedicated";
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("set_screener_source", {
    p_title_id: input.titleId,
    p_source: input.source,
  });
  if (error) return { error: error.message };

  revalidatePath(`/titles/${input.titleId}`);
  return {};
}

// Set a title's release type + (for a re-release) the historical original date.
// Client-owned; written via set_title_release_info (operate-gated in the DB). The
// forward-looking release_date is GC-owned and set elsewhere.
export async function setTitleReleaseInfo(input: {
  orgId: string;
  titleId: string;
  releaseType: "new_release" | "re_release";
  originalReleaseDate?: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("set_title_release_info", {
    p_org_id: input.orgId,
    p_title_id: input.titleId,
    p_release_type: input.releaseType,
    p_original_release_date:
      input.releaseType === "re_release" ? input.originalReleaseDate : undefined,
  });
  if (error) return { error: error.message };

  revalidatePath(`/titles/${input.titleId}`);
  return {};
}

// Submit a draft title for chain-of-title review (§11): draft → in_review, via
// the submit_title RPC (operate-gated in the DB).
export async function submitTitle(
  orgId: string,
  titleId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("submit_title", { p_org_id: orgId, p_title_id: titleId });
  if (error) return { error: error.message };

  // §19: submit is a findings trigger too — refresh from current metadata (best-effort;
  // a reconcile failure must not fail the submit, which already committed).
  try {
    const { data: metaRow } = await supabase
      .from("title_metadata")
      .select("data")
      .eq("title_id", titleId)
      .maybeSingle();
    const findings = computeMetadataFindings((metaRow?.data as Record<string, unknown>) ?? {});
    await supabase.rpc("reconcile_title_findings", {
      p_org_id: orgId,
      p_title_id: titleId,
      p_findings: findings as unknown as Json,
      p_logic_version: METADATA_LOGIC_VERSION,
    });
  } catch (e) {
    console.error("[findings] reconcile after submit failed", e);
  }

  revalidatePath(`/titles/${titleId}`);
  return {};
}

// Create (or replace) a screener share link for a named buyer. The raw token is persisted
// as share_token so the URL can be re-copied on later page loads — acceptable for a screener
// (view-only, still OTP-gated at the portal; the OTP is the real gate, not the URL).
// Authorization is the RPC itself — member_can(...,'operate') on the title's org plus the
// post-approval status gate — never this action.
//
// Links are now per-buyer, not per-title: calling this again for the SAME recipient name is
// the "replace" — the RPC revokes that buyer's previous live link first, so a URL already sent
// to them stops resolving. A different name creates a second, independent link. Matching is
// case-insensitive in the DB but the casing the client types is what gets stored and shown, so
// "tubi" and "Tubi" collide (replace, not two rows) — do not add client-side normalisation that
// would contradict that.
//
// A collision is a SILENT, DESTRUCTIVE replace from the client's point of view: typing a name
// that already has a live link kills the URL already emailed to that buyer with no signal that
// just happened. So unless the caller has explicitly asked to replace (the "Replace link"
// button on an existing row — a deliberate, informed action), check for a live link with the
// same name first and refuse with a message rather than silently swapping it out. The check
// uses `.ilike()` on the escaped, trimmed name so it matches the RPC's real matching SQL
// (`lower(recipient_name) is not distinct from lower(nullif(btrim(p_recipient_name), ''))`,
// 20260806000200:161) — see lib/buyer-names.ts for why the escaping matters (a name with a
// literal % or _ would otherwise become a wildcard).
//
// AUTHOR PARTITION. The RPC's revoke is also partitioned by author —
// `is_gc_staff(created_by) = v_is_gc` (same migration, :160) — so GC's link for "Tubi" and a
// client's link for "Tubi" never collide in the database; they're different rows on different
// sides. For today's only caller of this action — a real client-org member — that's already
// exactly what portal_links_select's RLS policy hands back: its ELSE branch (for a non-GC-view
// caller) filters to `not is_gc_staff(created_by)`, so the candidates below are already scoped
// to the client's own side with no extra work. But that policy's FIRST branch lets any
// GC-staff caller see EVERY row on the title regardless of author (`gc_can(auth.uid(),'view')`
// with no purpose/author filter), so if this action is ever reached by GC staff — e.g. a
// future view-as-client feature; nothing renders BuyerShareControl for GC today — the
// candidates would include the client's own rows too, and a plain "any row matched" check
// would raise a collision the RPC would never actually have caused. Rather than assume only
// clients ever call this, derive whether THIS caller is GC staff and, if so, narrow to rows
// they themselves created. That's narrower than the RPC's true "GC side" (all GC staff, not
// just this one caller), which could in principle miss a collision a DIFFERENT GC staffer
// created — acceptable for a path nothing reaches yet, and the failure mode stays "no
// warning shown", never "warned about / blocked a replace the RPC wouldn't have done" — the
// RPC's own author partition is what actually protects the data either way.
export async function createBuyerScreenerLink(input: {
  titleId: string;
  recipientName: string;
  replace?: boolean;
}): Promise<{ error?: string; url?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated." };
  const recipient = input.recipientName.trim();
  if (!recipient) return { error: "Enter the buyer's name." };

  if (!input.replace) {
    // Independent reads — fire together rather than in sequence.
    const [{ data: gcStaffRow }, { data: candidates }] = await Promise.all([
      supabase.from("gc_staff").select("user_id").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("portal_links")
        .select("recipient_name, created_by")
        .eq("title_id", input.titleId)
        .eq("purpose", "screener_view")
        .is("revoked_at", null)
        .ilike("recipient_name", escapeIlikePattern(recipient))
        // At most one live row per side can match a given name (the RPC enforces that), so 2
        // would suffice; 5 is a small defensive margin, not a real list — this is an
        // existence check, not a page.
        .limit(5),
    ]);
    const isGc = !!gcStaffRow;
    const existing = (candidates ?? []).find((c) => !isGc || c.created_by === user.id);
    if (existing?.recipient_name) {
      return {
        error: `A link for ${existing.recipient_name} already exists. Use Replace link on that buyer to send a new URL, or enter a different name.`,
      };
    }
  }

  const token = generateToken();
  const { error } = await supabase.rpc("create_screener_link", {
    p_title_id: input.titleId,
    p_token_hash: hashToken(token),
    p_share_token: token,
    p_recipient_name: recipient,
  });
  if (error) return { error: error.message };

  const base = process.env.PORTAL_BASE_URL?.replace(/\/+$/, "") ?? "";
  revalidatePath(`/titles/${input.titleId}`);
  return { url: `${base}/portal/${token}` };
}

// Withdraw the live link without minting a replacement — "stop sharing this".
export async function revokeBuyerScreenerLink(input: {
  linkId: string;
  titleId: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("revoke_portal_link", { p_link_id: input.linkId });
  if (error) return { error: error.message };

  revalidatePath(`/titles/${input.titleId}`);
  return {};
}
