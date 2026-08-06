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
// Links are per-buyer, not per-title: calling this again for the SAME recipient name is the
// "replace" — the RPC revokes that buyer's previous live link first, so a URL already sent to
// them stops resolving. A different name creates a second, independent link. Matching is
// case-insensitive in the DB but the casing the client types is what gets stored and shown, so
// "tubi" and "Tubi" collide (replace, not two rows) — do not add client-side normalisation that
// would contradict that.
//
// Unification (20260806000300): the match is on (title, recipient) alone — no author partition.
// Whoever created the earlier live link for that buyer, a same-name create replaces it. So the
// collision check below reads every live screener_view link on the title regardless of who
// created it; it does not need to know or care whether the caller is GC staff.
//
// A collision is a SILENT, DESTRUCTIVE replace from the client's point of view: typing a name
// that already has a live link kills the URL already emailed to that buyer with no signal that
// just happened. So unless the caller has explicitly asked to replace (the "Replace link"
// button on an existing row — a deliberate, informed action), check for a live link with the
// same name first and refuse with a message rather than silently swapping it out. The check
// uses `.ilike()` on the escaped, trimmed name so it matches the RPC's real matching SQL
// (`lower(recipient_name) is not distinct from lower(nullif(btrim(p_recipient_name), ''))`,
// 20260806000300) — see lib/buyer-names.ts for why the escaping matters (a name with a literal
// % or _ would otherwise become a wildcard).
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
    const { data: candidates } = await supabase
      .from("portal_links")
      .select("recipient_name")
      .eq("title_id", input.titleId)
      .eq("purpose", "screener_view")
      .is("revoked_at", null)
      .ilike("recipient_name", escapeIlikePattern(recipient))
      // At most one live row can match a given name (the RPC enforces that), so 1 would
      // suffice; 5 is a small defensive margin, not a real list — this is an existence check,
      // not a page.
      .limit(5);
    const existing = candidates?.[0];
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
