"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { generateToken, hashToken } from "@/lib/portal";
import { sendOrgNotificationEmail } from "@/lib/email";
import { NOTIFICATION_EMAIL } from "@/lib/notifications";
import type { Database, Json } from "@/lib/supabase/database.types";

type Decision = Database["public"]["Enums"]["review_decision"];

// GC decision. Gated at the DB by review_title (is_gc_staff); the (gc) layout
// already blocks non-GC users from reaching this surface.
export async function reviewTitle(
  titleId: string,
  decision: Decision,
  reason: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };
  if (decision === "reject" && !reason.trim()) return { error: "A reason is required to reject." };

  const { error } = await supabase.rpc("review_title", {
    p_title_id: titleId,
    p_decision: decision,
    p_reason: reason.trim(), // RPC nullif('' , '') stores null; approve ignores it
  });
  if (error) return { error: error.message };

  // §20 push: a rejection is bad news the client must know about — notify (says why).
  // Best-effort — the review already committed, so a notify failure must not fail it.
  if (decision === "reject") {
    try {
      const { data: t } = await supabase
        .from("titles")
        .select("title, org_id")
        .eq("id", titleId)
        .maybeSingle();
      if (t) {
        const body = `"${t.title}" was returned for revision: ${reason.trim()}`;
        await supabase.rpc("create_notification", {
          p_org_id: t.org_id,
          p_kind: "title_rejected",
          p_title: "Title returned for revision",
          p_body: body,
          p_source_refs: { title_id: titleId, reason: reason.trim() } as Json,
        });
        // §20 email leg: same message, to every active member of the org (best-effort).
        const copy = NOTIFICATION_EMAIL.title_rejected;
        await sendOrgNotificationEmail(supabase, t.org_id, {
          subject: copy.subject({ title: t.title }),
          body,
          ctaLabel: copy.cta,
          ctaPath: copy.path({ titleId }),
        });
      }
    } catch (e) {
      console.error("[notifications] title_rejected create failed", e);
    }
  }

  revalidatePath("/gc/review");
  return {};
}

// GC links a title to the same work as another title. Gated at the DB by
// link_title_to_work_of (is_gc_staff); the (gc) layout also blocks non-GC users.
export async function linkTitleToWork(
  titleId: string,
  targetTitleId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("link_title_to_work_of", {
    p_title_id: titleId,
    p_target_title_id: targetTitleId,
  });
  if (error) return { error: error.message };

  revalidatePath("/gc/review");
  return {};
}

// Create (or reset) the ONE reusable screener share link for a title. The RPC revokes any
// prior live screener link first, so calling this again is the "reset". Unlike master-download
// links (hash-only), the raw token is persisted as share_token so GC can re-copy the URL on
// later page loads — acceptable for a screener (view-only, OTP-gated; see the migration note).
// GC gate is the RPC itself (is_gc_staff + screenable-asset check), not this action.
export async function createScreenerLink(input: { titleId: string }): Promise<{ error?: string; url?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const token = generateToken();
  const { error } = await supabase.rpc("create_screener_link", {
    p_title_id: input.titleId,
    p_token_hash: hashToken(token),
    p_share_token: token,
  });
  if (error) return { error: error.message };

  const base = process.env.PORTAL_BASE_URL?.replace(/\/+$/, "") ?? "";
  revalidatePath("/gc/review");
  revalidatePath(`/gc/titles/${input.titleId}`);
  return { url: `${base}/portal/${token}` };
}

export async function revokeScreenerLink(input: { linkId: string }): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const { error } = await supabase.rpc("revoke_portal_link", { p_link_id: input.linkId });
  if (error) return { error: error.message };

  revalidatePath("/gc/review");
  return {};
}
